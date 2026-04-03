import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

export function AddEtfDialog() {
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/etfs", {
        symbol: symbol.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/etfs"] });
      toast({ title: "ETF added", description: `${symbol.trim().toUpperCase()} has been added.` });
      setSymbol("");
      setName("");
      setDescription("");
      setOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && symbol.trim() && name.trim()) {
      e.preventDefault();
      createMutation.mutate();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-add-etf">
          <Plus className="w-4 h-4 mr-2" />
          Add ETF
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an ETF</DialogTitle>
          <DialogDescription>
            Enter the ETF ticker symbol and a display name to track its performance.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="etf-symbol">Ticker Symbol</Label>
            <Input
              id="etf-symbol"
              placeholder="e.g. SPY, QQQ, VTI"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              data-testid="input-etf-symbol"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="etf-name">Display Name</Label>
            <Input
              id="etf-name"
              placeholder="e.g. S&P 500 ETF"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              data-testid="input-etf-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="etf-desc">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              id="etf-desc"
              placeholder="Brief description of the ETF..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="resize-none"
              rows={3}
              data-testid="input-etf-description"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!symbol.trim() || !name.trim() || createMutation.isPending}
            data-testid="button-submit-etf"
          >
            {createMutation.isPending ? "Adding..." : "Add ETF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
