import { useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import type { MaintenancePhoto } from "@/types/maintenance";
import { formatTime } from "@/lib/date";
import { getPhotoById } from "@/lib/photoStore";
import { FullscreenPhotoViewer } from "@/components/FullscreenPhotoViewer";

interface PhotoGalleryProps {
  photos: MaintenancePhoto[];
}

export function PhotoGallery({ photos }: PhotoGalleryProps) {
  const [selectedPhoto, setSelectedPhoto] = useState<MaintenancePhoto | null>(null);
  const [selectedFullPhoto, setSelectedFullPhoto] = useState<MaintenancePhoto | null>(null);
  const [isLoadingFullPhoto, setIsLoadingFullPhoto] = useState(false);
  const selectedLoadIdRef = useRef(0);
  const activeFullPhotoUrlRef = useRef<string | null>(null);

  useEffect(() => {
    selectedLoadIdRef.current += 1;
    const loadId = selectedLoadIdRef.current;

    if (!selectedPhoto) {
      if (activeFullPhotoUrlRef.current) {
        URL.revokeObjectURL(activeFullPhotoUrlRef.current);
        activeFullPhotoUrlRef.current = null;
      }
      setSelectedFullPhoto(null);
      setIsLoadingFullPhoto(false);
      return;
    }

    if (activeFullPhotoUrlRef.current) {
      URL.revokeObjectURL(activeFullPhotoUrlRef.current);
      activeFullPhotoUrlRef.current = null;
    }

    setSelectedFullPhoto(null);
    setIsLoadingFullPhoto(true);

    void (async () => {
      try {
        const fullPhoto = await getPhotoById(selectedPhoto.id);
        if (loadId !== selectedLoadIdRef.current) {
          if (fullPhoto?.url.startsWith("blob:")) {
            URL.revokeObjectURL(fullPhoto.url);
          }
          return;
        }

        if (fullPhoto?.url.startsWith("blob:")) {
          activeFullPhotoUrlRef.current = fullPhoto.url;
        }
        setSelectedFullPhoto(fullPhoto);
      } finally {
        if (loadId === selectedLoadIdRef.current) {
          setIsLoadingFullPhoto(false);
        }
      }
    })();
  }, [selectedPhoto]);

  useEffect(
    () => () => {
      if (activeFullPhotoUrlRef.current) {
        URL.revokeObjectURL(activeFullPhotoUrlRef.current);
        activeFullPhotoUrlRef.current = null;
      }
    },
    [],
  );

  if (photos.length === 0) {
    return (
      <Box
        sx={{
          textAlign: "center",
          py: 4,
          color: "text.secondary",
          bgcolor: "rgba(0, 0, 0, 0.04)",
          borderRadius: 2,
          border: "2px dashed",
          borderColor: "divider",
        }}
      >
        <Typography variant="body2">Még nincs fotó</Typography>
        <Typography variant="caption" sx={{ display: "block", mt: 0.5 }}>
          A munka lezárásához töltsön fel legalább egy fotót
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 1.5 }}>
        {photos.map((photo) => (
          <Box
            key={photo.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedPhoto(photo)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                setSelectedPhoto(photo);
              }
            }}
            sx={{
              position: "relative",
              borderRadius: 2,
              overflow: "hidden",
              bgcolor: "rgba(0, 0, 0, 0.04)",
              boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)",
              animation: "scaleIn 0.2s ease-out",
              cursor: "pointer",
              outline: "none",
              "&:focus-visible": { boxShadow: "0 0 0 3px rgba(2, 50, 45, 0.3)" },
            }}
          >
            <Box
              component="img"
              src={photo.url}
              alt={photo.description || "Karbantartási fotó"}
              sx={{ width: "100%", height: 128, objectFit: "cover" }}
            />
            <Box
              sx={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                color: "#fff",
                px: 1,
                py: 0.75,
                background:
                  "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.7) 100%)",
              }}
            >
              <Typography variant="caption" sx={{ fontWeight: 600 }} noWrap>
                {photo.description || "Nincs leírás"}
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.7, display: "block" }}>
                {formatTime(photo.timestamp)}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
      <FullscreenPhotoViewer
        open={Boolean(selectedPhoto)}
        photo={selectedFullPhoto}
        fallbackPhoto={selectedPhoto}
        loading={isLoadingFullPhoto}
        onClose={() => setSelectedPhoto(null)}
      />
    </>
  );
}
