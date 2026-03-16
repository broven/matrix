#!/bin/bash
set -e

# Build iOS .ipa locally and upload to GitHub Release
# No Apple Developer account needed - AltStore re-signs with user's Apple ID
#
# Usage: ./scripts/build-ios.sh [tag]
# Example: ./scripts/build-ios.sh v0.1.0-rc.4

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${1:-$(git describe --tags --abbrev=0 2>/dev/null || echo '')}"

if [ -z "$TAG" ]; then
  echo "Usage: $0 <tag>"
  exit 1
fi

VERSION="${TAG#v}"
APPLE_DIR="$REPO_ROOT/packages/client/src-tauri/gen/apple"
IPA_NAME="Matrix_v${VERSION}.ipa"

echo "=== Building iOS for $TAG ==="

# 1. Build workspace
echo "[1/5] Building workspace packages..."
cd "$REPO_ROOT"
pnpm -r build > /dev/null 2>&1

# 2. Build Rust for iOS
echo "[2/5] Building Rust for iOS..."
cd "$REPO_ROOT/packages/client/src-tauri"
touch binaries/matrix-server-aarch64-apple-ios
chmod +x binaries/matrix-server-aarch64-apple-ios
cargo build --release --target aarch64-apple-ios 2>&1 | tail -1

# 3. Init iOS project if needed
if [ ! -d "$APPLE_DIR/matrix-client.xcodeproj" ]; then
  echo "[3/5] Initializing iOS project..."
  cd "$REPO_ROOT/packages/client"
  pnpm tauri ios init 2>&1 | tail -3
else
  echo "[3/5] iOS project exists"
fi

# 4. Build with xcodebuild (no signing needed for AltStore)
echo "[4/5] Building with xcodebuild..."
cd "$APPLE_DIR"

xcodebuild \
  -project matrix-client.xcodeproj \
  -scheme matrix-client_iOS \
  -configuration Release \
  -sdk iphoneos \
  -destination "generic/platform=iOS" \
  -archivePath ./build/Matrix.xcarchive \
  archive \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  CODE_SIGNING_ALLOWED=YES \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="-" \
  2>&1 | grep -E "ARCHIVE (SUCCEEDED|FAILED)|error:|BUILD" | tail -5

ARCHIVE_PATH="$APPLE_DIR/build/Matrix.xcarchive"
if [ ! -d "$ARCHIVE_PATH" ]; then
  echo "Archive failed. Try: open Xcode → Product → Archive"
  exit 1
fi

# 5. Package IPA (no signing - AltStore re-signs)
echo "[5/5] Packaging IPA..."
mkdir -p /tmp/ipa-build/Payload
cp -r "$ARCHIVE_PATH/Products/Applications/"*.app /tmp/ipa-build/Payload/
cd /tmp/ipa-build
zip -qr "$REPO_ROOT/$IPA_NAME" Payload
rm -rf /tmp/ipa-build

IPA_SIZE=$(stat -f%z "$REPO_ROOT/$IPA_NAME" 2>/dev/null || stat -c%s "$REPO_ROOT/$IPA_NAME")
echo "  IPA: $IPA_NAME ($(echo "$IPA_SIZE / 1048576" | bc)MB)"

# Upload to GitHub Release
if gh release view "$TAG" > /dev/null 2>&1; then
  echo "  Uploading to release $TAG..."
  gh release upload "$TAG" "$REPO_ROOT/$IPA_NAME" --clobber
fi

# Update altstore-source.json
DOWNLOAD_URL="https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/releases/download/$TAG/$IPA_NAME"
DATE=$(date +%Y-%m-%d)
cd "$REPO_ROOT"
jq --arg v "$VERSION" --arg url "$DOWNLOAD_URL" --arg size "$IPA_SIZE" --arg date "$DATE" \
   '.apps[0].versions = [{"version":$v,"date":$date,"downloadURL":$url,"size":($size|tonumber),"minOSVersion":"16.0"}] + .apps[0].versions' \
   altstore-source.json > tmp.json && mv tmp.json altstore-source.json

echo ""
echo "=== Done ==="
echo "Release: https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/releases/tag/$TAG"
echo "Commit altstore-source.json to update AltStore."
