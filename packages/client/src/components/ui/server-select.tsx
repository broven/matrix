import { Server } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ServerOption } from "@/hooks/useAddRepoServerSelect";

interface ServerSelectProps {
  servers: ServerOption[];
  value: string;
  onChange: (serverId: string) => void;
}

export function ServerSelect({ servers, value, onChange }: ServerSelectProps) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">Server</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full rounded-lg" data-testid="server-select">
          <SelectValue placeholder="Select server" />
        </SelectTrigger>
        <SelectContent>
          {servers.map((s) => (
            <SelectItem key={s.id} value={s.id} data-testid={`server-option-${s.id}`}>
              <Server className="size-3.5 text-muted-foreground" />
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
