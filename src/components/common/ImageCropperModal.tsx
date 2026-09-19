import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  Check,
  X,
  ZoomIn,
  Move,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Modal } from "./Modal";

interface Props {
  open: boolean;
  imageSrc: string | null;
  onClose: () => void;
  onCropComplete: (croppedBase64: string) => void;
}

interface CropWorkspaceProps {
  imageSrc: string;
  onClose: () => void;
  onCropComplete: (croppedBase64: string) => void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  coordinateRatio: number;
}

const CROP_COORDINATE_SIZE = 250;
const OUTPUT_SIZE = 512;

function CropWorkspace({
  imageSrc,
  onClose,
  onCropComplete,
}: CropWorkspaceProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [imageStatus, setImageStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [error, setError] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const zoomId = useId();
  const instructionsId = useId();

  const handlePointerDown = (
    event: PointerEvent<HTMLDivElement>
  ) => {
    if (
      imageStatus !== "ready" ||
      event.button !== 0 ||
      dragRef.current
    ) {
      return;
    }

    const width = event.currentTarget.clientWidth;
    if (!width) return;

    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
      coordinateRatio: CROP_COORDINATE_SIZE / width,
    };
  };

  const handlePointerMove = (
    event: PointerEvent<HTMLDivElement>
  ) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) return;

    setOffset({
      x:
        drag.offsetX +
        (event.clientX - drag.startX) * drag.coordinateRatio,
      y:
        drag.offsetY +
        (event.clientY - drag.startY) * drag.coordinateRatio,
    });
  };

  const handlePointerEnd = (
    event: PointerEvent<HTMLDivElement>
  ) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;

    dragRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLDivElement>
  ) => {
    if (
      imageStatus !== "ready" ||
      event.isDefaultPrevented() ||
      event.nativeEvent.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    const step = event.shiftKey ? 15 : 5;
    let dx = 0;
    let dy = 0;

    switch (event.key) {
      case "ArrowLeft":
        dx = -step;
        break;
      case "ArrowRight":
        dx = step;
        break;
      case "ArrowUp":
        dy = -step;
        break;
      case "ArrowDown":
        dy = step;
        break;
      default:
        return;
    }

    event.preventDefault();

    setOffset((current) => ({
      x: current.x + dx,
      y: current.y + dy,
    }));
  };

  const handleApplyCrop = () => {
    const image = imageRef.current;
    const viewport = viewportRef.current;

    if (
      imageStatus !== "ready" ||
      !image ||
      !viewport ||
      !image.naturalWidth ||
      !image.naturalHeight
    ) {
      return;
    }

    setError(null);

    try {
      const viewportSize = viewport.clientWidth;
      if (!viewportSize) {
        throw new Error("Не удалось определить размер области кадрирования.");
      }

      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;

      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Браузер не смог подготовить изображение.");
      }

      context.fillStyle = "#000";
      context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

      /*
       * CSS-превью хранит смещение в системе координат 250×250.
       * Поэтому изменение экранного размера не меняет выбранный кадр.
       *
       * Размер img берём до transform: scale применяется ниже
       * точно так же, как в превью.
       */
      const outputRatio = OUTPUT_SIZE / viewportSize;
      const offsetRatio = OUTPUT_SIZE / CROP_COORDINATE_SIZE;

      const drawWidth = image.width * scale * outputRatio;
      const drawHeight = image.height * scale * outputRatio;

      const drawX =
        OUTPUT_SIZE / 2 + offset.x * offsetRatio - drawWidth / 2;
      const drawY =
        OUTPUT_SIZE / 2 + offset.y * offsetRatio - drawHeight / 2;

      context.drawImage(
        image,
        drawX,
        drawY,
        drawWidth,
        drawHeight
      );

      const result = canvas.toDataURL("image/jpeg", 0.9);

      onCropComplete(result);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось сохранить выбранный кадр."
      );
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-surface-2 px-3 py-5 sm:p-6">
        <div
          ref={viewportRef}
          role="group"
          aria-label="Область кадрирования аватара"
          aria-describedby={instructionsId}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onLostPointerCapture={() => {
            dragRef.current = null;
          }}
          onKeyDown={handleKeyDown}
          className="relative mx-auto aspect-square w-[250px] max-w-full touch-none select-none overflow-hidden rounded-full bg-black cursor-grab active:cursor-grabbing"
        >
          <img
            ref={imageRef}
            src={imageSrc}
            alt=""
            draggable={false}
            onLoad={() => {
              if (imageRef.current?.naturalWidth) {
                setImageStatus("ready");
                setError(null);
              } else {
                setImageStatus("error");
              }
            }}
            onError={() => setImageStatus("error")}
            className="pointer-events-none absolute block h-auto w-auto max-w-none origin-center select-none"
            style={{
              maxHeight: "100%",
              left: `${50 + (offset.x / CROP_COORDINATE_SIZE) * 100}%`,
              top: `${50 + (offset.y / CROP_COORDINATE_SIZE) * 100}%`,
              transform: `translate(-50%, -50%) scale(${scale})`,
              visibility: imageStatus === "ready" ? "visible" : "hidden",
            }}
          />

          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-inset ring-accent/60"
          />

          {imageStatus === "loading" && (
            <div
              role="status"
              className="absolute inset-0 flex items-center justify-center bg-surface-3"
            >
              <Loader2
                size={26}
                aria-hidden="true"
                className="animate-spin text-accent"
              />
              <span className="sr-only">
                Загрузка изображения…
              </span>
            </div>
          )}

          {imageStatus === "error" && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-3">
              <AlertCircle
                size={28}
                aria-hidden="true"
                className="text-danger"
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2.5">
        <Move
          size={18}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-content-muted"
        />
        <p
          id={instructionsId}
          className="text-sm leading-relaxed text-content-secondary"
        >
          Перетаскивайте фото пальцем или мышью. С клавиатуры:
          выберите область кадрирования и используйте стрелки.
          Shift увеличивает шаг перемещения.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor={zoomId}
            className="flex items-center gap-2 text-sm font-medium text-content-secondary"
          >
            <ZoomIn size={17} aria-hidden="true" />
            Масштаб
          </label>

          <output
            htmlFor={zoomId}
            className="text-sm font-medium tabular-nums text-accent"
          >
            {Math.round(scale * 100)}%
          </output>
        </div>

        <input
          id={zoomId}
          type="range"
          min={1}
          max={3.5}
          step={0.05}
          value={scale}
          disabled={imageStatus !== "ready"}
          onChange={(event) => setScale(Number(event.target.value))}
          className="block h-11 w-full accent-accent disabled:opacity-50"
        />
      </div>

      {(error || imageStatus === "error") && (
        <div
          role="alert"
          className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm leading-relaxed text-danger"
        >
          {error ||
            "Не удалось загрузить изображение. Закройте кадрирование и выберите другой файл."}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 border-t border-border pt-5">
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface-2 px-3 py-3 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-3 hover:text-content motion-reduce:transition-none"
        >
          <X size={17} aria-hidden="true" />
          Отмена
        </button>

        <button
          type="button"
          onClick={handleApplyCrop}
          disabled={imageStatus !== "ready"}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-3 py-3 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 motion-reduce:transition-none"
        >
          <Check size={18} aria-hidden="true" />
          Сохранить
        </button>
      </div>
    </div>
  );
}

export function ImageCropperModal({
  open,
  imageSrc,
  onClose,
  onCropComplete,
}: Props) {
  if (!imageSrc) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="center"
      size="sm"
      title="Кадрирование аватара"
    >
      <CropWorkspace
        key={imageSrc}
        imageSrc={imageSrc}
        onClose={onClose}
        onCropComplete={onCropComplete}
      />
    </Modal>
  );
}