import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { Box, CircularProgress, Dialog, IconButton, Typography } from "@mui/material";
import { X } from "lucide-react";
import type { MaintenancePhoto } from "@/types/maintenance";

interface FullscreenPhotoViewerProps {
  open: boolean;
  photo: MaintenancePhoto | null;
  fallbackPhoto: MaintenancePhoto | null;
  loading: boolean;
  onClose: () => void;
}

type Point = {
  x: number;
  y: number;
};

type GestureState = {
  mode: "none" | "drag" | "pinch";
  dragStart: Point;
  initialOffset: Point;
  initialZoom: number;
  initialDistance: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const distanceBetween = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const midpointBetween = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

export function FullscreenPhotoViewer({
  open,
  photo,
  fallbackPhoto,
  loading,
  onClose,
}: FullscreenPhotoViewerProps) {
  const displayPhoto = photo ?? fallbackPhoto;
  const captionPhoto = fallbackPhoto ?? photo;
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [viewportSize, setViewportSize] = useState({
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
  });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const offsetRef = useRef(offset);
  const zoomRef = useRef(zoom);
  const pointersRef = useRef<Map<number, Point>>(new Map());
  const gestureRef = useRef<GestureState>({
    mode: "none",
    dragStart: { x: 0, y: 0 },
    initialOffset: { x: 0, y: 0 },
    initialZoom: 1,
    initialDistance: 1,
  });

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    if (!open) {
      setNaturalSize(null);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      pointersRef.current.clear();
      gestureRef.current = {
        mode: "none",
        dragStart: { x: 0, y: 0 },
        initialOffset: { x: 0, y: 0 },
        initialZoom: 1,
        initialDistance: 1,
      };
      return;
    }

    const updateViewport = () => {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => {
      window.removeEventListener("resize", updateViewport);
    };
  }, [open, displayPhoto?.url]);

  useEffect(() => {
    if (!displayPhoto) {
      setNaturalSize(null);
      return;
    }

    setNaturalSize(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    pointersRef.current.clear();
    gestureRef.current = {
      mode: "none",
      dragStart: { x: 0, y: 0 },
      initialOffset: { x: 0, y: 0 },
      initialZoom: 1,
      initialDistance: 1,
    };
  }, [displayPhoto]);

  const baseScale = useMemo(() => {
    if (!naturalSize || naturalSize.width === 0 || naturalSize.height === 0) {
      return 1;
    }
    if (viewportSize.width === 0 || viewportSize.height === 0) {
      return 1;
    }
    return Math.min(viewportSize.width / naturalSize.width, viewportSize.height / naturalSize.height);
  }, [naturalSize, viewportSize.height, viewportSize.width]);

  const displayScale = baseScale * zoom;
  const hasPhoto = Boolean(displayPhoto && naturalSize);

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!hasPhoto) {
      return;
    }

    const container = event.currentTarget;
    container.setPointerCapture(event.pointerId);

    const pointer = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, pointer);

    if (pointersRef.current.size === 1) {
      gestureRef.current = {
        mode: "drag",
        dragStart: pointer,
        initialOffset: offsetRef.current,
        initialZoom: zoomRef.current,
        initialDistance: 1,
      };
      return;
    }

    if (pointersRef.current.size >= 2) {
      const [first, second] = Array.from(pointersRef.current.values());
      gestureRef.current = {
        mode: "pinch",
        dragStart: midpointBetween(first, second),
        initialOffset: offsetRef.current,
        initialZoom: zoomRef.current,
        initialDistance: Math.max(distanceBetween(first, second), 1),
      };
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId) || !hasPhoto) {
      return;
    }

    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const gesture = gestureRef.current;
    if (gesture.mode === "drag" && pointersRef.current.size === 1) {
      const pointer = pointersRef.current.get(event.pointerId);
      if (!pointer) {
        return;
      }

      const deltaX = pointer.x - gesture.dragStart.x;
      const deltaY = pointer.y - gesture.dragStart.y;
      setOffset({
        x: gesture.initialOffset.x + deltaX,
        y: gesture.initialOffset.y + deltaY,
      });
      return;
    }

    if (gesture.mode !== "pinch" || pointersRef.current.size < 2) {
      return;
    }

    const [first, second] = Array.from(pointersRef.current.values());
    const currentDistance = Math.max(distanceBetween(first, second), 1);
    const currentCenter = midpointBetween(first, second);
    const zoomFactor = currentDistance / gesture.initialDistance;
    const nextZoom = clamp(gesture.initialZoom * zoomFactor, 1, 6);
    const ratio = nextZoom / gesture.initialZoom;
    const viewportCenter = { x: viewportSize.width / 2, y: viewportSize.height / 2 };
    const centerOffset = {
      x: currentCenter.x - viewportCenter.x,
      y: currentCenter.y - viewportCenter.y,
    };

    setZoom(nextZoom);
    setOffset({
      x: gesture.initialOffset.x * ratio + (1 - ratio) * centerOffset.x,
      y: gesture.initialOffset.y * ratio + (1 - ratio) * centerOffset.y,
    });
  };

  const finishPointerGesture = (pointerId: number) => {
    pointersRef.current.delete(pointerId);

    if (pointersRef.current.size === 0) {
      gestureRef.current = {
        mode: "none",
        dragStart: { x: 0, y: 0 },
        initialOffset: offsetRef.current,
        initialZoom: zoomRef.current,
        initialDistance: 1,
      };
      return;
    }

    if (pointersRef.current.size === 1 && hasPhoto) {
      const remainingPointer = Array.from(pointersRef.current.values())[0];
      gestureRef.current = {
        mode: "drag",
        dragStart: remainingPointer,
        initialOffset: offsetRef.current,
        initialZoom: zoomRef.current,
        initialDistance: 1,
      };
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    finishPointerGesture(event.pointerId);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    finishPointerGesture(event.pointerId);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      PaperProps={{
        sx: {
          bgcolor: "#000",
          color: "#fff",
          overflow: "hidden",
        },
      }}
    >
      <Box
        sx={{
          position: "relative",
          width: "100vw",
          height: "100vh",
          overflow: "hidden",
          touchAction: "none",
          bgcolor: "#000",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <IconButton
          onClick={onClose}
          aria-label="Bezárás"
          sx={{
            position: "absolute",
            top: 16,
            left: 16,
            zIndex: 2,
            bgcolor: "rgba(0, 0, 0, 0.45)",
            color: "#fff",
            "&:hover": { bgcolor: "rgba(0, 0, 0, 0.65)" },
          }}
        >
          <X size={18} />
        </IconButton>

        {captionPhoto ? (
          <Box
            sx={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 2,
              px: 2,
              py: 1.5,
              background:
                "linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.78) 100%)",
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {captionPhoto.description || "Nincs leírás"}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.8, display: "block" }}>
              {new Date(captionPhoto.timestamp).toLocaleString("hu-HU")}
            </Typography>
          </Box>
        ) : null}

        {displayPhoto ? (
          naturalSize ? (
            <Box
              sx={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: `${naturalSize.width}px`,
                height: `${naturalSize.height}px`,
                transform: `translate(-50%, -50%) translate3d(${offset.x}px, ${offset.y}px, 0) scale(${displayScale})`,
                transformOrigin: "center center",
                willChange: "transform",
              }}
            >
              <Box
                component="img"
                key={displayPhoto.url}
                src={displayPhoto.url}
                alt={displayPhoto.description || "Karbantartási fotó"}
                onLoad={handleImageLoad}
                sx={{
                  display: "block",
                  width: "100%",
                  height: "100%",
                  userSelect: "none",
                  pointerEvents: "none",
                  WebkitUserDrag: "none",
                }}
              />
            </Box>
          ) : (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                px: 2,
                py: 2,
              }}
            >
              <Box
                component="img"
                key={displayPhoto.url}
                src={displayPhoto.url}
                alt={displayPhoto.description || "Karbantartási fotó"}
                onLoad={handleImageLoad}
                sx={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  userSelect: "none",
                  pointerEvents: "none",
                  WebkitUserDrag: "none",
                }}
              />
            </Box>
          )
        ) : null}

        {!displayPhoto || loading ? (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              bgcolor: "rgba(0, 0, 0, 0.35)",
            }}
          >
            <CircularProgress color="inherit" />
          </Box>
        ) : null}
      </Box>
    </Dialog>
  );
}
