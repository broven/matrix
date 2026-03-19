import { FolderGit2, FolderOpen, Link } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AddRepositoryMenuProps {
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
}

export function AddRepositoryMenu({
  onOpenProject,
  onCloneFromUrl,
}: AddRepositoryMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="w-full justify-center gap-2 rounded-xl text-sm"
          size="sm"
          data-testid="add-repo-btn"
        >
          <FolderGit2 className="size-4" />
          Add Repository
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" side="top">
        <DropdownMenuItem onClick={onOpenProject} data-testid="open-local-option">
          <FolderOpen className="size-4" />
          Open Project
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCloneFromUrl} data-testid="clone-url-option">
          <Link className="size-4" />
          Clone from URL
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
