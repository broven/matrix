import { useState, useEffect, useMemo } from "react";

export interface FileMention {
  /** Unique ID for this mention instance */
  id: string;
  /** Relative file path */
  path: string;
  /** Display name (filename) */
  name: string;
  /** Position in the text where the @ was typed */
  insertPosition: number;
}

interface UseFileMentionOptions {
  /** All files available for mention */
  files: string[];
  /** Current text in the input */
  text: string;
  /** Current cursor position */
  cursorPos: number;
}

interface UseFileMentionResult {
  /** Whether the popover should be visible */
  isOpen: boolean;
  /** Filtered file list based on query */
  filtered: string[];
  /** Current query string (after @) */
  query: string;
  /** Index of the @ that triggered the popover */
  atIndex: number;
  /** Currently selected index in the list */
  selectedIndex: number;
  setSelectedIndex: (index: number | ((prev: number) => number)) => void;
}

export function useFileMention({ files, text, cursorPos }: UseFileMentionOptions): UseFileMentionResult {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Find the @ query: look backwards from cursor for "@"
  const textBeforeCursor = text.slice(0, cursorPos);
  const atIndex = textBeforeCursor.lastIndexOf("@");

  let query = "";
  let isActive = false;

  if (atIndex !== -1 && files.length > 0) {
    // Only activate if "@" is at start or preceded by whitespace
    if (atIndex === 0 || /\s/.test(textBeforeCursor[atIndex - 1])) {
      const afterAt = textBeforeCursor.slice(atIndex + 1);
      // Only activate if there's no space in the query (still typing the filename)
      if (!/\s/.test(afterAt)) {
        query = afterAt.toLowerCase();
        isActive = true;
      }
    }
  }

  const filtered = useMemo(() => {
    if (!isActive) return [];
    if (!query) return files.slice(0, 50); // Show first 50 when no query
    return files
      .filter((f) => f.toLowerCase().includes(query))
      .slice(0, 50);
  }, [isActive, query, files]);

  const isOpen = filtered.length > 0;

  // Reset selection when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [isOpen, filtered.length]);

  return {
    isOpen,
    filtered,
    query,
    atIndex,
    selectedIndex,
    setSelectedIndex,
  };
}
