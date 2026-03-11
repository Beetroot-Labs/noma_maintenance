import Quagga, { type QuaggaJSResultObject } from "@ericblade/quagga2";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type ScannerProfileId = "1080P" | "720P";
type ScannerFeedbackState = "SUCCESS" | "FAILURE" | null;

export type Code128DetectionResult =
  | {
      status: "success";
    }
  | {
      status: "failure";
      errorMessage?: string;
    }
  | {
      status: "ignore";
    };

type UseCode128ScannerOptions = {
  containerRef: RefObject<HTMLDivElement>;
  onDetected: (scannedCode: string) => Promise<Code128DetectionResult> | Code128DetectionResult;
};

export const useCode128Scanner = ({
  containerRef,
  onDetected,
}: UseCode128ScannerOptions) => {
  const onDetectedRef = useRef(onDetected);
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  const [isStarting, setIsStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flashlightSupported, setFlashlightSupported] = useState(false);
  const [flashlightEnabled, setFlashlightEnabled] = useState(false);

  const detectedHandlerRef = useRef<((result: QuaggaJSResultObject) => void) | null>(null);
  const processedHandlerRef = useRef<((result: QuaggaJSResultObject) => void) | null>(null);
  const processingRef = useRef(false);
  const feedbackResetTimerRef = useRef<number | null>(null);
  const feedbackStateRef = useRef<ScannerFeedbackState>(null);
  const scannerProfileRef = useRef<ScannerProfileId>("1080P");
  const fpsSamplesRef = useRef<number[]>([]);
  const fallbackTriggeredRef = useRef(false);
  const restartPendingRef = useRef(false);
  const flashlightWantedRef = useRef(false);
  const flashlightVerificationTimerRef = useRef<number | null>(null);
  const flashlightEnabledRef = useRef(false);

  const setFeedbackState = useCallback((state: ScannerFeedbackState) => {
    if (feedbackResetTimerRef.current !== null) {
      window.clearTimeout(feedbackResetTimerRef.current);
      feedbackResetTimerRef.current = null;
    }
    feedbackStateRef.current = state;
    if (state) {
      feedbackResetTimerRef.current = window.setTimeout(() => {
        feedbackStateRef.current = null;
        feedbackResetTimerRef.current = null;
      }, 1000);
    }
  }, []);

  const clearFlashlightVerificationTimer = useCallback(() => {
    if (flashlightVerificationTimerRef.current !== null) {
      window.clearTimeout(flashlightVerificationTimerRef.current);
      flashlightVerificationTimerRef.current = null;
    }
  }, []);

  const readTorchSetting = useCallback((track: MediaStreamTrack | null) => {
    if (!track || typeof track.getSettings !== "function") {
      return null;
    }

    const settings = track.getSettings() as MediaTrackSettings & { torch?: boolean };
    return typeof settings.torch === "boolean" ? settings.torch : null;
  }, []);

  const formatFlashlightError = useCallback((nextState: boolean, error: unknown) => {
    const baseMessage = nextState
      ? "A zseblámpát nem sikerült bekapcsolni."
      : "A zseblámpát nem sikerült kikapcsolni.";

    if (!(error instanceof Error) || !error.message) {
      return baseMessage;
    }

    return `${baseMessage} Részlet: ${error.name}: ${error.message}`;
  }, []);

  const updateFlashlightEnabled = useCallback((nextState: boolean) => {
    flashlightEnabledRef.current = nextState;
    setFlashlightEnabled(nextState);
  }, []);

  const stop = useCallback((options?: { preserveFlashlightPreference?: boolean }) => {
    const preserveFlashlightPreference = options?.preserveFlashlightPreference ?? false;
    const stream = containerRef.current?.querySelector("video")?.srcObject;
    const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : null;
    if (track && (flashlightEnabledRef.current || flashlightWantedRef.current)) {
      void track
        .applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] })
        .catch(() => undefined);
    }
    clearFlashlightVerificationTimer();

    if (detectedHandlerRef.current) {
      Quagga.offDetected(detectedHandlerRef.current);
      detectedHandlerRef.current = null;
    } else {
      Quagga.offDetected();
    }
    if (processedHandlerRef.current) {
      Quagga.offProcessed(processedHandlerRef.current);
      processedHandlerRef.current = null;
    } else {
      Quagga.offProcessed();
    }
    void Quagga.stop().catch(() => undefined);

    processingRef.current = false;
    fpsSamplesRef.current = [];
    if (feedbackResetTimerRef.current !== null) {
      window.clearTimeout(feedbackResetTimerRef.current);
      feedbackResetTimerRef.current = null;
    }
    feedbackStateRef.current = null;

    if (Quagga.canvas?.ctx?.overlay && Quagga.canvas?.dom?.overlay) {
      Quagga.canvas.ctx.overlay.clearRect(
        0,
        0,
        Quagga.canvas.dom.overlay.width,
        Quagga.canvas.dom.overlay.height,
      );
    }

    setIsStarting(false);
    updateFlashlightEnabled(false);
    setFlashlightSupported(false);
    if (!preserveFlashlightPreference) {
      flashlightWantedRef.current = false;
    }
  }, [clearFlashlightVerificationTimer, containerRef, updateFlashlightEnabled]);

  const applyFlashlightState = useCallback(
    async (nextState: boolean) => {
      const stream = containerRef.current?.querySelector("video")?.srcObject;
      const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : null;
      if (!track) {
        updateFlashlightEnabled(false);
        return {
          ok: false,
          actualState: false,
          errorMessage: "A zseblámpa nem érhető el.",
        };
      }

      try {
        clearFlashlightVerificationTimer();
        await track.applyConstraints({
          advanced: [{ torch: nextState } as MediaTrackConstraintSet],
        });

        const currentTorchSetting = readTorchSetting(track);
        const actualState = currentTorchSetting ?? nextState;
        updateFlashlightEnabled(actualState);

        if (nextState) {
          flashlightVerificationTimerRef.current = window.setTimeout(() => {
            flashlightVerificationTimerRef.current = null;
            const verifiedTorchSetting = readTorchSetting(track);
            if (verifiedTorchSetting === false) {
              flashlightWantedRef.current = false;
              updateFlashlightEnabled(false);
              setCameraError(
                "A zseblámpa bekapcsolt, de az eszköz vagy a böngésző azonnal kikapcsolta.",
              );
              console.warn("Flashlight was enabled but reverted immediately.", {
                profile: scannerProfileRef.current,
                trackSettings:
                  typeof track.getSettings === "function" ? track.getSettings() : undefined,
              });
            }
          }, 450);
        }

        return {
          ok: actualState === nextState,
          actualState,
          errorMessage:
            actualState === nextState
              ? null
              : nextState
                ? "A zseblámpa bekapcsolt, de az eszköz vagy a böngésző nem tartotta aktívan."
                : "A zseblámpa kikapcsolási állapota nem erősíthető meg.",
        };
      } catch (error) {
        console.warn("Failed to change flashlight state.", error);
        updateFlashlightEnabled(false);
        return {
          ok: false,
          actualState: false,
          errorMessage: formatFlashlightError(nextState, error),
        };
      }
    },
    [
      clearFlashlightVerificationTimer,
      containerRef,
      formatFlashlightError,
      readTorchSetting,
      updateFlashlightEnabled,
    ],
  );

  const detectFlashlightSupport = useCallback(() => {
    const stream = containerRef.current?.querySelector("video")?.srcObject;
    const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : null;
    const capabilities =
      typeof track?.getCapabilities === "function"
        ? (track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean })
        : null;
    setFlashlightSupported(Boolean(capabilities?.torch));

    const zoomCapabilities = capabilities as MediaTrackCapabilities & {
      zoom?: { min?: number; max?: number };
    };
    const minZoom = zoomCapabilities.zoom?.min;
    if (track && typeof minZoom === "number") {
      void track
        .applyConstraints({ advanced: [{ zoom: minZoom } as MediaTrackConstraintSet] })
        .catch(() => undefined);
    }

    if (track) {
      void track
        .applyConstraints({
          advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet],
        })
        .catch(() => undefined);
    }
  }, [containerRef]);

  const tryBoostTrackToMaxResolution = useCallback(async () => {
    const stream = containerRef.current?.querySelector("video")?.srcObject;
    const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : null;
    if (!track) {
      return;
    }
    const capabilities =
      typeof track.getCapabilities === "function"
        ? (track.getCapabilities() as MediaTrackCapabilities & {
            width?: { max?: number };
            height?: { max?: number };
          })
        : null;
    const maxWidth = capabilities?.width?.max;
    const maxHeight = capabilities?.height?.max;
    if (typeof maxWidth !== "number" || typeof maxHeight !== "number") {
      return;
    }

    await track
      .applyConstraints({
        width: { exact: maxWidth },
        height: { exact: maxHeight },
      })
      .catch(() => undefined);
  }, [containerRef]);

  const start = useCallback(
    (profile: ScannerProfileId = "1080P") => {
      if (!containerRef.current) {
        return;
      }

      scannerProfileRef.current = profile;
      stop({ preserveFlashlightPreference: true });
      setCameraError(null);
      setIsStarting(true);

      const scheduleFallbackTo720p = () => {
        if (restartPendingRef.current) {
          return;
        }
        restartPendingRef.current = true;
        scannerProfileRef.current = "720P";
        window.setTimeout(() => {
          restartPendingRef.current = false;
          if (!processingRef.current) {
            start("720P");
          }
        }, 120);
      };

      const onDetectedHandler = async (result: QuaggaJSResultObject) => {
        if (processingRef.current) {
          return;
        }

        const scannedCode = result.codeResult.code?.trim() ?? "";
        if (!scannedCode) {
          return;
        }

        processingRef.current = true;
        try {
          const detectionResult = await onDetectedRef.current(scannedCode);
          const status = detectionResult?.status ?? "success";

          if (status === "ignore") {
            processingRef.current = false;
            return;
          }

          if (status === "failure") {
            setFeedbackState("FAILURE");
            if (detectionResult.errorMessage) {
              setCameraError(detectionResult.errorMessage);
            }
            processingRef.current = false;
            return;
          }

          setFeedbackState("SUCCESS");
          stop();
        } catch (error) {
          setFeedbackState("FAILURE");
          setCameraError(
            error instanceof Error ? error.message : "Nem sikerült feldolgozni a beolvasott kódot.",
          );
          processingRef.current = false;
        }
      };

      const onProcessedHandler = (result: QuaggaJSResultObject) => {
        const ctx = Quagga.canvas?.ctx?.overlay;
        const canvas = Quagga.canvas?.dom?.overlay;
        if (!ctx || !canvas) {
          return;
        }

        const now = performance.now();
        const samples = fpsSamplesRef.current;
        samples.push(now);
        if (samples.length > 24) {
          samples.shift();
        }
        if (
          samples.length >= 10 &&
          !fallbackTriggeredRef.current &&
          scannerProfileRef.current !== "720P"
        ) {
          const elapsedMs = samples[samples.length - 1] - samples[0];
          if (elapsedMs > 0) {
            const fps = ((samples.length - 1) * 1000) / elapsedMs;
            if (fps < 6) {
              fallbackTriggeredRef.current = true;
              scheduleFallbackTo720p();
              return;
            }
          }
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (result?.boxes) {
          result.boxes
            .filter((box) => box !== result.box)
            .forEach((box) => {
              Quagga.ImageDebug.drawPath(box as unknown[], { x: 0, y: 1 }, ctx, {
                color: "rgba(255, 255, 255, 0.55)",
                lineWidth: 1,
              });
            });
        }

        if (result?.box) {
          const state = feedbackStateRef.current;
          const activeColor =
            state === "SUCCESS"
              ? "#22C55E"
              : state === "FAILURE"
                ? "#EF4444"
                : "#EAB308";

          Quagga.ImageDebug.drawPath(result.box as unknown[], { x: 0, y: 1 }, ctx, {
            color: activeColor,
            lineWidth: 3,
          });
        }
      };

      detectedHandlerRef.current = onDetectedHandler;
      processedHandlerRef.current = onProcessedHandler;

      const constraints =
        profile === "720P"
          ? {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            };

      const initScanner = async (inputConstraints?: MediaTrackConstraints) => {
        const shouldSuppressQuaggaLog = (message: string) =>
          message.includes("InputStreamBrowser createLiveStream") ||
          message.includes("InputStreamBrowser createVideoStream");

        const originalLog = console.log;
        const originalWarn = console.warn;
        console.log = (...args: unknown[]) => {
          const first = typeof args[0] === "string" ? args[0] : "";
          if (shouldSuppressQuaggaLog(first)) {
            return;
          }
          originalLog(...args);
        };
        console.warn = (...args: unknown[]) => {
          const first = typeof args[0] === "string" ? args[0] : "";
          if (shouldSuppressQuaggaLog(first)) {
            return;
          }
          originalWarn(...args);
        };

        try {
          await Quagga.init({
            inputStream: {
              type: "LiveStream",
              target: containerRef.current,
              constraints: inputConstraints,
              area: {
                top: "35%",
                right: "14%",
                left: "14%",
                bottom: "35%",
              },
            },
            decoder: {
              readers: ["code_128_reader"],
            },
            locator: {
              patchSize: "medium",
              halfSample: true,
            },
            locate: true,
            numOfWorkers:
              typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number"
                ? Math.max(1, Math.min(4, navigator.hardwareConcurrency))
                : 2,
            frequency: 10,
          });
        } finally {
          console.log = originalLog;
          console.warn = originalWarn;
        }
      };

      void initScanner(constraints)
        .then(() => {
          Quagga.onDetected(onDetectedHandler);
          Quagga.onProcessed(onProcessedHandler);
          Quagga.start();
          setIsStarting(false);
          if (profile === "1080P") {
            void tryBoostTrackToMaxResolution();
          }
          window.setTimeout(() => {
            detectFlashlightSupport();
            if (flashlightWantedRef.current) {
              void applyFlashlightState(true).then((result) => {
                if (!result.ok && result.errorMessage) {
                  setCameraError(result.errorMessage);
                }
                flashlightWantedRef.current = result.actualState;
              });
            }
          }, 0);
        })
        .catch(async () => {
          try {
            // Fallback for browsers/devices that reject advanced facingMode/size hints.
            await initScanner({ width: { ideal: 1280 }, height: { ideal: 720 } });
            Quagga.onDetected(onDetectedHandler);
            Quagga.onProcessed(onProcessedHandler);
            Quagga.start();
            setIsStarting(false);
            window.setTimeout(() => {
              detectFlashlightSupport();
              if (flashlightWantedRef.current) {
                void applyFlashlightState(true).then((result) => {
                  if (!result.ok && result.errorMessage) {
                    setCameraError(result.errorMessage);
                  }
                  flashlightWantedRef.current = result.actualState;
                });
              }
            }, 0);
          } catch {
            setCameraError("Nem sikerült elindítani a kamerát.");
            setIsStarting(false);
          }
        });
    },
    [
      applyFlashlightState,
      containerRef,
      detectFlashlightSupport,
      setFeedbackState,
      stop,
      tryBoostTrackToMaxResolution,
    ],
  );

  const toggleFlashlight = useCallback(async () => {
    const nextState = !flashlightEnabled;
    flashlightWantedRef.current = nextState;
    const result = await applyFlashlightState(nextState);
    flashlightWantedRef.current = result.actualState;
    if (!result.ok && result.errorMessage) {
      setCameraError(result.errorMessage);
    }
  }, [applyFlashlightState, flashlightEnabled]);

  return {
    isStarting,
    cameraError,
    setCameraError,
    flashlightSupported,
    flashlightEnabled,
    start,
    stop,
    toggleFlashlight,
  };
};
