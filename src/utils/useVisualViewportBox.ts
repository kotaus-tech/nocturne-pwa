import { useEffect, useState } from "react";

export interface ViewportBox {
  /** Высота видимой области (без клавиатуры), px. null — API недоступен. */
  height: number | null;
  /** Смещение видимой области относительно страницы, px. */
  top: number;
}

/**
 * Следит за visualViewport: когда открыта экранная клавиатура, видимая
 * область меньше экрана. Корень чата подстраивается под неё, и поле ввода
 * не уезжает под клавиатуру.
 */
export function useVisualViewportBox(): ViewportBox {
  const [box, setBox] = useState<ViewportBox>({ height: null, top: 0 });

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;

    const update = () =>
      setBox({ height: Math.round(vv.height), top: Math.round(vv.offsetTop) });

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return box;
}
