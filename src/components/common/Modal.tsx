import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  useId,
} from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "framer-motion";
import { X } from "lucide-react";
import { cn } from "../../utils/cn";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  variant?: "center" | "sheet";
  size?: "sm" | "md" | "lg";
  ariaLabel?: string;
}

interface ModalLayerProps extends Omit<ModalProps, "open"> {
  titleId: string;
}

interface ActiveModal {
  container: HTMLDivElement;
  panel: HTMLDivElement;
}

const activeModals: ActiveModal[] = [];
const previousInertValues = new Map<HTMLElement, boolean>();

let previousBodyOverflow = "";
let previousBodyOverflowPriority = "";

function getTopModal(): ActiveModal | undefined {
  return activeModals[activeModals.length - 1];
}

function updateBackgroundInert() {
  const topModal = getTopModal();

  for (const [element, previousValue] of previousInertValues) {
    element.inert = previousValue;
  }

  if (!topModal) {
    previousInertValues.clear();
    return;
  }

  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement)) continue;

    if (!previousInertValues.has(child)) {
      previousInertValues.set(child, child.inert);
    }

    if (child === topModal.container) {
      child.inert = false;
    } else {
      child.inert = true;
    }
  }
}

function registerModal(modal: ActiveModal) {
  if (activeModals.length === 0) {
    previousBodyOverflow = document.body.style.getPropertyValue("overflow");
    previousBodyOverflowPriority =
      document.body.style.getPropertyPriority("overflow");

    document.body.style.setProperty("overflow", "hidden");
  }

  activeModals.push(modal);
  updateBackgroundInert();
}

function unregisterModal(modal: ActiveModal) {
  const index = activeModals.indexOf(modal);

  if (index !== -1) {
    activeModals.splice(index, 1);
  }

  updateBackgroundInert();

  if (activeModals.length === 0) {
    if (previousBodyOverflow) {
      document.body.style.setProperty(
        "overflow",
        previousBodyOverflow,
        previousBodyOverflowPriority
      );
    } else {
      document.body.style.removeProperty("overflow");
    }
  }
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    "a[href]",
    "area[href]",
    "button",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "[tabindex]",
    "[contenteditable='true']",
    "audio[controls]",
    "video[controls]",
    "summary",
  ].join(",");

  return Array.from(
    container.querySelectorAll<HTMLElement>(selector)
  ).filter((element) => {
    if (element.tabIndex < 0) return false;
    if (element.matches(":disabled")) return false;
    if (element.closest("[inert], [hidden]")) return false;
    if (element.getClientRects().length === 0) return false;

    const styles = window.getComputedStyle(element);

    return (
      styles.visibility !== "hidden" &&
      styles.display !== "none"
    );
  });
}

function focusWithoutScroll(element: HTMLElement | null) {
  if (!element) return;

  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function ModalLayer({
  onClose,
  title,
  children,
  variant = "center",
  size = "md",
  ariaLabel = "Диалог",
  titleId,
}: ModalLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const backdropPointerDown = useRef(false);

  const reducedMotion = useReducedMotion();
  const isPresent = useIsPresent();
  const isPresentRef = useRef(isPresent);

  const [returnFocusElement] = useState<HTMLElement | null>(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );

  useLayoutEffect(() => {
    closeRef.current = onClose;
    isPresentRef.current = isPresent;
  }, [onClose, isPresent]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const panel = panelRef.current;

    if (!container || !panel) return;

    const modal: ActiveModal = { container, panel };
    registerModal(modal);

    if (!panel.contains(document.activeElement)) {
      focusWithoutScroll(panel);
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (getTopModal() !== modal) return;

      if (event.key === "Escape") {
        if (event.isComposing || !isPresentRef.current) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        focusWithoutScroll(panel);
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      const focusIsOutside =
        !(activeElement instanceof Node) ||
        !panel.contains(activeElement);

      if (
        event.shiftKey &&
        (activeElement === first ||
          activeElement === panel ||
          focusIsOutside)
      ) {
        event.preventDefault();
        focusWithoutScroll(last);
        return;
      }

      if (
        !event.shiftKey &&
        (activeElement === last ||
          activeElement === panel ||
          focusIsOutside)
      ) {
        event.preventDefault();
        focusWithoutScroll(first);
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (getTopModal() !== modal) return;
      const target = event.target;
      if (!(target instanceof Node) || !panel.contains(target)) {
        focusWithoutScroll(panel);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);

      const wasTopModal = getTopModal() === modal;
      unregisterModal(modal);

      if (!wasTopModal) return;

      const nextModal = getTopModal();
      const canRestoreOriginalFocus =
        returnFocusElement?.isConnected &&
        !returnFocusElement.closest("[inert]") &&
        !returnFocusElement.matches(":disabled") &&
        returnFocusElement.getClientRects().length > 0 &&
        (!nextModal || nextModal.panel.contains(returnFocusElement));

      if (canRestoreOriginalFocus) {
        focusWithoutScroll(returnFocusElement);
      } else if (nextModal) {
        focusWithoutScroll(nextModal.panel);
      }
    };
  }, [returnFocusElement]);

  const isSheet = variant === "sheet";

  const panelInitial = reducedMotion
    ? { opacity: 0 }
    : {
        opacity: 0,
        y: isSheet ? 20 : 10,
        scale: isSheet ? 1 : 0.985,
      };

  const panelExit = reducedMotion
    ? { opacity: 0 }
    : {
        opacity: 0,
        y: isSheet ? 16 : 8,
        scale: isSheet ? 1 : 0.99,
      };

  return (
    <motion.div
      ref={containerRef}
      className={cn(
        "fixed inset-0 z-50 flex justify-center overflow-hidden",
        "bg-black/80 backdrop-blur-sm",
        "p-3 sm:p-6",
        isSheet
          ? "items-end pb-0 sm:items-center sm:pb-6"
          : "items-center"
      )}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.16 }}
      onPointerDown={(event) => {
        backdropPointerDown.current =
          event.target === event.currentTarget && event.button === 0;
      }}
      onPointerCancel={() => {
        backdropPointerDown.current = false;
      }}
      onClick={(event) => {
        const isBackdropClick =
          event.target === event.currentTarget && backdropPointerDown.current;
        backdropPointerDown.current = false;

        if (
          isBackdropClick &&
          isPresentRef.current &&
          getTopModal()?.container === containerRef.current
        ) {
          closeRef.current();
        }
      }}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        initial={panelInitial}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={panelExit}
        transition={{
          duration: reducedMotion ? 0 : 0.2,
          ease: [0.16, 1, 0.3, 1],
        }}
        className={cn(
          "relative flex max-h-[92vh] sm:max-h-[88vh] min-h-0 w-full flex-col",
          "overflow-hidden border border-white/[0.08] bg-[#10141d]",
          "text-content shadow-2xl outline-none focus-visible:outline-none",
          isSheet
            ? "rounded-t-3xl sm:rounded-3xl"
            : "rounded-3xl",
          size === "sm" && "max-w-md",
          size === "md" && "max-w-lg",
          size === "lg" && "max-w-3xl"
        )}
      >
        <header
          className={cn(
            "relative z-10 flex shrink-0 items-center justify-between gap-3",
            "bg-[#10141d] px-4 py-3 sm:px-5 sm:py-3.5",
            title && "border-b border-white/[0.07]"
          )}
        >
          <h2
            id={titleId}
            className={cn(
              title
                ? "min-w-0 flex-1 truncate text-base sm:text-lg font-bold tracking-tight text-zinc-100"
                : "sr-only"
            )}
          >
            {title || ariaLabel}
          </h2>

          <button
            type="button"
            aria-label="Закрыть диалог"
            onClick={() => {
              if (
                isPresentRef.current &&
                getTopModal()?.container === containerRef.current
              ) {
                closeRef.current();
              }
            }}
            className={cn(
              "ml-auto flex h-8.5 w-8.5 sm:h-9 sm:w-9 shrink-0 items-center justify-center",
              "rounded-xl border border-white/[0.08] bg-surface-2",
              "text-content-secondary transition-all",
              "hover:border-white/[0.16] hover:bg-surface-3 hover:text-content",
              "active:scale-95 motion-reduce:transition-none"
            )}
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </header>

        <div
          className={cn(
            "min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5",
            isSheet && "pb-[max(20px,env(safe-area-inset-bottom))] sm:pb-5"
          )}
        >
          {children}
        </div>
      </motion.div>
    </motion.div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  variant = "center",
  size = "md",
  ariaLabel,
}: ModalProps) {
  const titleId = useId();

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <ModalLayer
          key="modal-layer"
          onClose={onClose}
          title={title}
          titleId={titleId}
          variant={variant}
          size={size}
          ariaLabel={ariaLabel}
        >
          {children}
        </ModalLayer>
      )}
    </AnimatePresence>,
    document.body
  );
}