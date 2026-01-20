import { useRef, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
} from "@mui/material";
import { Camera, ImagePlus, X } from "lucide-react";
import type { MaintenancePhoto } from "@/types/maintenance";
import { appColors } from "@/theme";

interface PhotoUploadProps {
  onPhotoAdd: (photo: MaintenancePhoto) => void;
}

export function PhotoUpload({ onPhotoAdd }: PhotoUploadProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
      setIsOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const handleClose = () => {
    setIsOpen(false);
    setPreview(null);
    setDescription("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSave = () => {
    if (!preview) return;
    const photo: MaintenancePhoto = {
      id: `photo-${Date.now()}`,
      url: preview,
      description: description.trim(),
      timestamp: new Date(),
    };
    onPhotoAdd(photo);
    handleClose();
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelect}
        style={{ display: "none" }}
        id="photo-input"
      />
      <Button
        variant="contained"
        fullWidth
        startIcon={<Camera size={18} />}
        onClick={() => fileInputRef.current?.click()}
        sx={{
          bgcolor: appColors.accent,
          color: appColors.accentForeground,
          "&:hover": { bgcolor: "hsl(36 95% 45%)" },
        }}
      >
        Fotó készítése / feltöltés
      </Button>

      <Dialog open={isOpen} onClose={handleClose} fullWidth maxWidth="sm">
        <DialogTitle>Fotó leírása</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {preview && (
            <Box sx={{ position: "relative", borderRadius: 2, overflow: "hidden", mb: 2 }}>
              <Box
                component="img"
                src={preview}
                alt="Előnézet"
                sx={{ width: "100%", height: 200, objectFit: "cover" }}
              />
              <IconButton
                onClick={handleClose}
                sx={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  bgcolor: appColors.destructive,
                  color: appColors.destructiveForeground,
                  "&:hover": { bgcolor: "hsl(0 72% 46%)" },
                }}
              >
                <X size={16} />
              </IconButton>
            </Box>
          )}
          <TextField
            label="Leírás"
            placeholder="Írja le, mit mutat a fotó (opcionális)..."
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            multiline
            minRows={3}
            fullWidth
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button variant="outlined" onClick={handleClose} fullWidth>
            Mégse
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            fullWidth
            startIcon={<ImagePlus size={16} />}
            sx={{
              bgcolor: appColors.success,
              color: appColors.successForeground,
              "&:hover": { bgcolor: "hsl(142 72% 38%)" },
            }}
          >
            Fotó mentése
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
