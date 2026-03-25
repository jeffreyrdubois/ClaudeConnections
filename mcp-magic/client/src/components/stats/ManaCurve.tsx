import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface ManaCurveProps {
  curve: Record<number, number>;
  title?: string;
}

const BAR_COLOR = "#f59e0b";

export default function ManaCurve({ curve, title = "Mana Curve" }: ManaCurveProps) {
  const data = [0, 1, 2, 3, 4, 5, 6, 7].map((cmc) => ({
    cmc: cmc === 7 ? "7+" : String(cmc),
    count: curve[cmc] || 0,
  }));

  const max = Math.max(...data.map((d) => d.count));

  return (
    <div>
      {title && <div className="text-sm font-medium text-gray-300 mb-3">{title}</div>}
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <XAxis dataKey="cmc" tick={{ fill: "#9ca3af", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{ backgroundColor: "#16213e", border: "1px solid #374151", borderRadius: "8px", color: "#f3f4f6" }}
            formatter={(value) => [`${value} cards`, "Count"]}
            labelFormatter={(l) => `CMC ${l}`}
          />
          <Bar dataKey="count" radius={[3, 3, 0, 0]}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.count === max && max > 0 ? "#f59e0b" : BAR_COLOR + "80"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
