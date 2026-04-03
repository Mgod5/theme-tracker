import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";

interface AddStockDialogProps {
  themeId: number;
  themeName: string;
}

export function AddStockDialog({ themeId, themeName }: AddStockDialogProps) {
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState("");
  const { toast } = useToast();

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/themes/${themeId}/stocks`, {
        symbol: symbol.toUpperCase().trim(),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/themes"] });
      toast({ title: "Stock added", description: `${symbol.toUpperCase()} added to "${themeName}".` });
      setSymbol("");
      setOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && symbol.trim()) {
      e.preventDefault();
      addMutation.mutate();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" data-testid={`button-add-stock-${themeId}`}>
          <Plus className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add stock to {themeName}</DialogTitle>
          <DialogDescription>
            Enter a stock ticker symbol to track within this theme.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="stock-symbol">Ticker Symbol</Label>
          <Input
            id="stock-symbol"
            placeholder="e.g. AAPL"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            className="uppercase font-mono"
            autoFocus
            data-testid="input-stock-symbol"
          />
          <p className="text-xs text-muted-foreground">
            Historical price data will be fetched automatically after adding.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => addMutation.mutate()}
            disabled={!symbol.trim() || addMutation.isPending}
            data-testid="button-submit-stock"
          >
            {addMutation.isPending ? "Adding..." : "Add Stock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
