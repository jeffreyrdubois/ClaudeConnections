// Renders MTG mana cost symbols as styled badges
// e.g. "{2}{U}{U}" → [2] [U] [U]

interface ManaSymbolProps {
  symbol: string; // Single symbol like "W", "U", "2", "X", "G/W" etc.
  size?: "sm" | "md" | "lg";
}

const SYMBOL_STYLES: Record<string, string> = {
  W: "bg-yellow-50 text-yellow-900 border border-yellow-200 shadow-sm",
  U: "bg-blue-600 text-white",
  B: "bg-gray-800 text-gray-100 border border-gray-600",
  R: "bg-red-600 text-white",
  G: "bg-green-700 text-white",
  C: "bg-gray-500 text-white",
  X: "bg-gray-600 text-gray-200",
  S: "bg-cyan-200 text-cyan-900", // Snow
  // Hybrid and generic handled below
};

function getSymbolStyle(sym: string): string {
  if (SYMBOL_STYLES[sym]) return SYMBOL_STYLES[sym];
  // Hybrid (e.g. "G/W") - use gold
  if (sym.includes("/")) return "bg-yellow-600 text-yellow-100";
  // Phyrexian (e.g. "P") - use black
  if (sym === "P") return "bg-gray-800 text-gray-100 border border-gray-600";
  // Generic numbers - gray
  if (/^\d+$/.test(sym)) return "bg-gray-600 text-gray-100";
  return "bg-gray-600 text-gray-200";
}

const SIZE_CLASSES = {
  sm: "w-4 h-4 text-[9px]",
  md: "w-5 h-5 text-[10px]",
  lg: "w-6 h-6 text-xs",
};

export function ManaSymbol({ symbol, size = "md" }: ManaSymbolProps) {
  const style = getSymbolStyle(symbol);
  const sizeClass = SIZE_CLASSES[size];
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-bold ${style} ${sizeClass}`}
      title={symbol}
    >
      {symbol === "T" ? "⟳" : symbol}
    </span>
  );
}

interface ManaCostProps {
  cost: string | null;
  size?: "sm" | "md" | "lg";
}

export function ManaCost({ cost, size = "md" }: ManaCostProps) {
  if (!cost) return null;

  // Parse "{2}{U}{U}" → ["2", "U", "U"]
  const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);

  if (!symbols.length) return <span className="text-gray-500 text-xs">—</span>;

  return (
    <div className="flex items-center gap-0.5 flex-wrap">
      {symbols.map((sym, i) => (
        <ManaSymbol key={i} symbol={sym} size={size} />
      ))}
    </div>
  );
}

interface ColorIdentityProps {
  identity: string[];
  size?: "sm" | "md" | "lg";
}

export function ColorIdentity({ identity, size = "md" }: ColorIdentityProps) {
  if (!identity || identity.length === 0) {
    return <ManaSymbol symbol="C" size={size} />;
  }
  return (
    <div className="flex items-center gap-0.5">
      {identity.map((c) => (
        <ManaSymbol key={c} symbol={c} size={size} />
      ))}
    </div>
  );
}
