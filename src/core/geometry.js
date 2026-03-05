const PI = Math.PI;

export function computeGeometry(shape, params) {
  switch (shape) {
    case "cube": {
      const a = Number(params.a ?? params.size ?? 1);
      return {
        shape,
        labels: { a },
        volume: a ** 3,
        surfaceArea: 6 * a * a,
      };
    }
    case "sphere": {
      const r = Number(params.r ?? params.radius ?? params.size ?? 1);
      return {
        shape,
        labels: { r },
        volume: (4 / 3) * PI * r ** 3,
        surfaceArea: 4 * PI * r ** 2,
      };
    }
    case "cylinder": {
      const r = Number(params.r ?? params.radius ?? 1);
      const h = Number(params.h ?? params.height ?? params.size ?? 1);
      return {
        shape,
        labels: { r, h },
        volume: PI * r * r * h,
        surfaceArea: 2 * PI * r * (r + h),
      };
    }
    case "cuboid": {
      const w = Number(params.w ?? params.width ?? 1.6);
      const h = Number(params.h ?? params.height ?? 1);
      const d = Number(params.d ?? params.depth ?? 0.9);
      return {
        shape,
        labels: { w, h, d },
        volume: w * h * d,
        surfaceArea: 2 * (w * h + w * d + h * d),
      };
    }
    default:
      return computeGeometry("cube", { a: 1 });
  }
}
