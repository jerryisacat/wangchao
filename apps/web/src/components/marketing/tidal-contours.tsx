interface TidalContoursProps {
  className?: string;
  compact?: boolean;
}

export function TidalContours({ className = "", compact = false }: TidalContoursProps) {
  const paths = compact
    ? [
        "M-80 175 C 100 65, 240 280, 470 142 S 790 60, 1120 188 S 1410 300, 1600 130",
        "M-90 220 C 90 110, 270 310, 500 180 S 800 100, 1110 226 S 1410 340, 1610 170",
        "M-100 265 C 110 155, 300 340, 530 218 S 850 145, 1150 266 S 1430 375, 1620 215",
      ]
    : [
        "M-120 75 C 80 -35, 230 170, 470 58 S 800 -15, 1090 118 S 1400 225, 1650 48",
        "M-120 120 C 90 10, 260 205, 500 92 S 825 22, 1120 154 S 1415 260, 1650 88",
        "M-110 168 C 100 55, 285 242, 530 132 S 850 65, 1150 192 S 1430 300, 1660 132",
        "M-105 217 C 120 105, 310 275, 560 173 S 880 110, 1180 232 S 1450 335, 1670 178",
        "M-100 268 C 135 158, 330 312, 590 218 S 915 158, 1210 275 S 1470 372, 1680 228",
        "M-90 320 C 150 212, 360 352, 620 267 S 950 210, 1240 320 S 1490 410, 1690 282",
      ];

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      preserveAspectRatio="none"
      viewBox="0 0 1500 360"
    >
      {paths.map((path, index) => (
        <path
          className="stroke-primary/20"
          d={path}
          key={path}
          opacity={0.48 - index * 0.045}
          strokeWidth={index % 2 === 0 ? 1.35 : 1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
