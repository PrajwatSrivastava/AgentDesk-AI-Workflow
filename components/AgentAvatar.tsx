import { cn } from "@/lib/cn";

// Same flower for every agent, only the colour changes. Outer rings are lighter.
const RINGS = [
  { count: 8, radius: 10, width: 4.5, height: 7, opacity: 0.95, offset: 309 },
  { count: 10, radius: 17.6, width: 3.9, height: 6.2, opacity: 0.73, offset: 344 },
  { count: 14, radius: 25.8, width: 6.6, height: 10.4, opacity: 0.51, offset: 237 },
];

const PETALS = RINGS.flatMap((ring) =>
  Array.from({ length: ring.count }, (_, index) => ({
    ...ring,
    angle: ring.offset + (index * 360) / ring.count,
  })),
);

export function AgentAvatar({
  color,
  size = 96,
  className,
}: {
  color: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      role="img"
      aria-hidden="true"
    >
      <g transform="translate(50 50)">
        {PETALS.map((petal, index) => (
          <ellipse
            key={index}
            cx={0}
            cy={-petal.radius}
            rx={petal.width}
            ry={petal.height}
            fill={color}
            opacity={petal.opacity}
            transform={`rotate(${petal.angle})`}
          />
        ))}
        <circle cx={0} cy={0} r={4.5} fill="#ffffff" />
      </g>
    </svg>
  );
}
