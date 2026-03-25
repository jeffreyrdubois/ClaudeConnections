import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

interface ColorPieProps {
  distribution: Record<string, number>;
  title?: string;
}

const COLOR_MAP: Record<string, string> = {
  W: "#fefce8",
  U: "#1d4ed8",
  B: "#374151",
  R: "#dc2626",
  G: "#15803d",
  C: "#6b7280",
};

const COLOR_LABELS: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};

const RADIAN = Math.PI / 180;

function CustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }: {
  cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number; name: string;
}) {
  if (percent < 0.05) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill={name === "W" ? "#78350f" : "white"} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
      {name}
    </text>
  );
}

export default function ColorPie({ distribution, title = "Color Distribution" }: ColorPieProps) {
  const data = Object.entries(distribution)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: k, value: v, label: COLOR_LABELS[k] || k }))
    .sort((a, b) => b.value - a.value);

  if (!data.length) {
    return (
      <div>
        {title && <div className="text-sm font-medium text-gray-300 mb-3">{title}</div>}
        <div className="text-gray-500 text-sm text-center py-8">No color data</div>
      </div>
    );
  }

  return (
    <div>
      {title && <div className="text-sm font-medium text-gray-300 mb-3">{title}</div>}
      <div className="flex items-center gap-4">
        <ResponsiveContainer width={140} height={140}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              outerRadius={65}
              dataKey="value"
              labelLine={false}
              label={CustomLabel}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={COLOR_MAP[entry.name] || "#6b7280"} stroke="#16213e" strokeWidth={2} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ backgroundColor: "#16213e", border: "1px solid #374151", borderRadius: "8px", color: "#f3f4f6" }}
              formatter={(value, _name, props) => [`${value} cards`, props.payload.label]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="space-y-1.5">
          {data.map((entry) => (
            <div key={entry.name} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: COLOR_MAP[entry.name] || "#6b7280" }} />
              <span className="text-xs text-gray-300">{entry.label}</span>
              <span className="text-xs text-gray-500 ml-auto">{entry.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
