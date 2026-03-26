import { Cell, ResponsiveContainer, Tooltip, Treemap } from "recharts";

interface TypeBreakdownProps {
  types: Record<string, number>;
  title?: string;
  onTypeClick?: (type: string) => void;
}

const TYPE_COLORS: Record<string, string> = {
  Land: "#78350f",
  Creature: "#14532d",
  Instant: "#1e3a5f",
  Sorcery: "#4c1d95",
  Enchantment: "#064e3b",
  Artifact: "#4b5563",
  Planeswalker: "#7c3aed",
  Battle: "#9f1239",
  Other: "#374151",
};

function CustomContent({ x, y, width, height, name, value }: {
  x: number; y: number; width: number; height: number; name: string; value: number; root?: boolean;
}) {
  if (width < 30 || height < 20) return null;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={TYPE_COLORS[name] || "#374151"} rx={4} stroke="#16213e" strokeWidth={2} />
      {width > 50 && height > 30 && (
        <>
          <text x={x + width / 2} y={y + height / 2 - 6} textAnchor="middle" fill="white" fontSize={11} fontWeight={600}>
            {name}
          </text>
          <text x={x + width / 2} y={y + height / 2 + 9} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize={10}>
            {value}
          </text>
        </>
      )}
    </g>
  );
}

export default function TypeBreakdown({ types, title = "Card Types", onTypeClick }: TypeBreakdownProps) {
  const data = Object.entries(types)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: k, size: v, value: v }))
    .sort((a, b) => b.size - a.size);

  if (!data.length) {
    return (
      <div>
        {title && <div className="text-sm font-medium text-gray-300 mb-3">{title}</div>}
        <div className="text-gray-500 text-sm text-center py-8">No card type data</div>
      </div>
    );
  }

  return (
    <div>
      {title && <div className="text-sm font-medium text-gray-300 mb-3">{title}</div>}
      <ResponsiveContainer width="100%" height={180}>
        <Treemap
          data={data}
          dataKey="size"
          aspectRatio={4 / 3}
          content={<CustomContent x={0} y={0} width={0} height={0} name="" value={0} />}
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={TYPE_COLORS[entry.name] || "#374151"} />
          ))}
          <Tooltip
            contentStyle={{ backgroundColor: "#16213e", border: "1px solid #374151", borderRadius: "8px", color: "#f3f4f6" }}
            formatter={(value, name) => [`${value} cards`, name]}
          />
        </Treemap>
      </ResponsiveContainer>
      {/* Legend */}
      <div className="flex flex-wrap gap-2 mt-2">
        {data.map((entry) => (
          <div
            key={entry.name}
            className={`flex items-center gap-1.5 ${onTypeClick ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
            onClick={() => onTypeClick?.(entry.name)}
          >
            <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: TYPE_COLORS[entry.name] || "#374151" }} />
            <span className="text-xs text-gray-400">{entry.name}</span>
            <span className="text-xs text-gray-600">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
