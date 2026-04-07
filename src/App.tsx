import { useState, useCallback } from "react";
import Button from "@weave-mui/button";
import Typography from "@weave-mui/typography";
import Stack from "@weave-mui/stack";
import Alert from "@weave-mui/alert";
import Divider from "@weave-mui/divider";
import LinearProgress from "@weave-mui/linear-progress";
import Accordion from "@weave-mui/accordion";
import AccordionSummary from "@weave-mui/accordion-summary";
import AccordionDetails from "@weave-mui/accordion-details";
import Slider from "@weave-mui/slider";
import { useForma } from "./useForma";
import { buildBoxGlb } from "./glb-builder";

type Transform16 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

interface LogEntry {
  time: string;
  level: "info" | "success" | "error" | "warning";
  message: string;
  detail?: string;
}

/**
 * Build a Forma-space transform: pure translation, no rotation.
 * Forma's volumeMesh renderer handles Y-up→Z-up conversion internally.
 */
function makeTransform(tx: number, ty: number, tz: number): Transform16 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    tx, ty, tz, 1,
  ];
}

function timestamp() {
  return new Date().toLocaleTimeString();
}

export default function App() {
  const { forma, error: sdkError } = useForma();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading] = useState(false);
  const [customAlpha, setCustomAlpha] = useState(0.5);

  const log = useCallback(
    (level: LogEntry["level"], message: string, detail?: string) => {
      setLogs((prev) => [{ time: timestamp(), level, message, detail }, ...prev]);
    },
    [],
  );

  const clearLogs = useCallback(() => setLogs([]), []);

  // ─── Pick a point in the scene ──────────────────────────────────────

  const pickPoint = useCallback(
    async (): Promise<{ x: number; y: number; z: number } | null> => {
      if (!forma) return null;
      log("info", "Click a point in the scene to place the element…");
      try {
        const point = await forma.designTool.getPoint();
        if (!point) {
          log("warning", "No point selected");
          return null;
        }
        const elevation = await forma.terrain.getElevationAt({ x: point.x, y: point.y });
        const z = elevation ?? 0;
        log("info", `Point picked: (${point.x.toFixed(1)}, ${point.y.toFixed(1)}, z=${z.toFixed(1)})`);
        return { x: point.x, y: point.y, z };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log("warning", `Point pick cancelled or failed: ${msg}`);
        return null;
      }
    },
    [forma, log],
  );

  // ─── Core: create a box element with a given alpha ──────────────────

  const createBoxElement = useCallback(
    async (alpha: number, label: string) => {
      if (!forma) return;
      const pt = await pickPoint();
      if (!pt) return;

      log("info", `Creating ${label} (alpha=${alpha})…`);

      try {
        const color: [number, number, number, number] = [0.2, 0.5, 1.0, alpha];
        const glb = buildBoxGlb({ width: 10, height: 10, depth: 10, color });
        log("info", `GLB built: ${glb.byteLength} bytes, alphaMode=${alpha < 1 ? "BLEND" : "OPAQUE"}`);

        const upload = await forma.integrateElements.uploadFile({ data: glb });
        log("success", `File uploaded: blobId=${upload.blobId}`);

        const { urn } = await forma.integrateElements.createElementV2({
          properties: { category: "generic" },
          representations: {
            volumeMesh: { type: "linked" as const, blobId: upload.blobId },
          },
        });
        log("success", `Element created: ${urn}`);

        const { path } = await forma.proposal.addElement({
          urn,
          transform: makeTransform(pt.x, pt.y, pt.z),
        });
        log("success", `${label} added to proposal at (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}, ${pt.z.toFixed(1)})`);

        // Apply transparent color override via elementColors (#RRGGBBAA)
        if (alpha < 1.0) {
          const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, "0");
          const colorHex = `#3380ff${alphaHex}`;
          const pathsToColor = new Map<string, string>();
          pathsToColor.set(path, colorHex);
          await forma.render.elementColors.set({ pathsToColor });
          log("success", `elementColors applied: ${colorHex} on ${path}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const detail = err instanceof Error ? err.stack : undefined;
        log("error", `Failed to create ${label}: ${msg}`, detail);
      }
    },
    [forma, log, pickPoint],
  );

  // ─── Render GLB (temporary scene) ───────────────────────────────────

  const renderGlbTemporary = useCallback(
    async (alpha: number, label: string) => {
      if (!forma) return;
      const pt = await pickPoint();
      if (!pt) return;

      log("info", `Rendering temporary GLB: ${label} (alpha=${alpha})…`);

      try {
        const color: [number, number, number, number] = [1.0, 0.3, 0.2, alpha];
        // Bake position + Y-up→Z-up rotation into the GLB since render.glb.add() has no transform param.
        // Forma (Xf,Yf,Zf) → glTF translation [Xf, Zf, -Yf]
        const glb = buildBoxGlb({
          width: 10, height: 10, depth: 10, color,
          translation: [pt.x, pt.z, -pt.y],
        });
        const { id } = await forma.render.glb.add({ glb });
        log("success", `Temporary GLB rendered (id=${id}) at (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}, ${pt.z.toFixed(1)}). Not persisted.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log("error", `Temporary GLB render failed: ${msg}`);
      }
    },
    [forma, log, pickPoint],
  );

  // ─── Terrain shape with fill.opacity ────────────────────────────────

  const createTerrainShapeElement = useCallback(
    async (opacity: number, label: string) => {
      if (!forma) return;
      const pt = await pickPoint();
      if (!pt) return;

      log("info", `Creating terrainShape element: ${label} (fill.opacity=${opacity})…`);

      try {
        const x = pt.x;
        const y = pt.y;
        const terrainShapeData = {
          type: "FeatureCollection" as const,
          features: [
            {
              type: "Feature" as const,
              geometry: {
                type: "Polygon" as const,
                coordinates: [
                  [
                    [x, y],
                    [x + 15, y],
                    [x + 15, y + 15],
                    [x, y + 15],
                    [x, y],
                  ],
                ],
              },
              properties: {
                fill: { color: "#ff6600", opacity },
                stroke: { color: "#ff3300", lineWidth: 0.5 },
              },
            },
          ],
        };

        const { urn } = await forma.integrateElements.createElementV2({
          properties: { category: "generic" },
          representations: {
            terrainShape: { type: "embedded-json" as const, data: terrainShapeData },
          },
        });
        log("success", `TerrainShape element created: ${urn}`);

        await forma.proposal.addElement({ urn });
        log("success", `${label} added to proposal`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log("error", `Failed to create ${label}: ${msg}`);
      }
    },
    [forma, log, pickPoint],
  );

  // ─── UI ─────────────────────────────────────────────────────────────

  const isPreview = !forma;

  return (
      <Stack spacing={2} sx={{ p: 2, maxWidth: 380 }}>
        <Typography variant="h2" sx={{ fontSize: 16, fontWeight: 600 }}>
          Transparent Material Examples
        </Typography>

        {sdkError && <Alert severity="error">{sdkError}</Alert>}

        {isPreview && !sdkError && (
          <Alert severity="info">
            Preview mode — running outside Forma. Buttons are disabled.
          </Alert>
        )}

        {loading && <LinearProgress />}

        <Divider />

        {/* ── volumeMesh examples ──────────────────────────────── */}

        <Typography variant="subtitle2">volumeMesh (GLB with PBR alpha)</Typography>
        <Typography variant="caption" color="text.secondary">
          Click a button, then pick a point in the scene to place the box.
        </Typography>

        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            disabled={isPreview || loading}
            onClick={() => createBoxElement(1.0, "Opaque box")}
          >
            Opaque
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={isPreview || loading}
            onClick={() => createBoxElement(0.5, "50% transparent box")}
          >
            50% Alpha
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={isPreview || loading}
            onClick={() => createBoxElement(0.1, "10% transparent box")}
          >
            10% Alpha
          </Button>
        </Stack>

        {/* ── Custom alpha slider ─────────────────────────────── */}

        <Accordion>
          <AccordionSummary>Custom alpha value</AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1}>
              <Typography variant="body1">
                Alpha: {customAlpha.toFixed(2)}
              </Typography>
              <Slider
                min={0}
                max={1}
                step={0.01}
                value={customAlpha}
                onChange={(_, v) => setCustomAlpha(v as number)}
              />
              <Button
                size="small"
                variant="outlined"
                disabled={isPreview || loading}
                onClick={() =>
                  createBoxElement(
                    customAlpha,
                    `Custom box (alpha=${customAlpha.toFixed(2)})`,
                  )
                }
              >
                Create with alpha={customAlpha.toFixed(2)}
              </Button>
            </Stack>
          </AccordionDetails>
        </Accordion>

        <Divider />

        {/* ── Temporary render examples ────────────────────────── */}

        <Typography variant="subtitle2">Temporary render (render.glb)</Typography>
        <Typography variant="caption" color="text.secondary">
          Renders at scene origin. Not persisted to proposal.
        </Typography>

        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            disabled={isPreview || loading}
            onClick={() => renderGlbTemporary(0.5, "Temp 50% GLB")}
          >
            50% Alpha
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={isPreview || loading}
            onClick={() => renderGlbTemporary(0.1, "Temp 10% GLB")}
          >
            10% Alpha
          </Button>
        </Stack>

        <Divider />

        {/* ── TerrainShape examples ────────────────────────────── */}

        <Typography variant="subtitle2">terrainShape (fill.opacity)</Typography>
        <Typography variant="caption" color="text.secondary">
          Click a button, then pick a point for the terrain polygon.
        </Typography>

        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            disabled={isPreview || loading}
            onClick={() => createTerrainShapeElement(1.0, "Opaque terrain")}
          >
            Opaque
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={isPreview || loading}
            onClick={() => createTerrainShapeElement(0.5, "50% terrain")}
          >
            50% Opacity
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={isPreview || loading}
            onClick={() => createTerrainShapeElement(0.1, "10% terrain")}
          >
            10% Opacity
          </Button>
        </Stack>

        <Divider />

        <Divider />

        {/* ── Log output ──────────────────────────────────────── */}

        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="subtitle2">
            Log ({logs.length} entries)
          </Typography>
          <Button size="small" variant="text" onClick={clearLogs}>
            Clear
          </Button>
        </Stack>

        <Stack
          spacing={0.5}
          sx={{
            maxHeight: 300,
            overflow: "auto",
            fontFamily: "monospace",
            fontSize: 11,
            bgcolor: "#f5f5f5",
            borderRadius: 1,
            p: 1,
          }}
        >
          {logs.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              No log entries yet. Click a button above to begin.
            </Typography>
          )}
          {logs.map((entry, i) => (
            <Stack key={i} spacing={0}>
              <Typography
                variant="caption"
                sx={{
                  fontSize: 11,
                  color:
                    entry.level === "error"
                      ? "error.main"
                      : entry.level === "success"
                        ? "success.main"
                        : entry.level === "warning"
                          ? "warning.main"
                          : "text.primary",
                  wordBreak: "break-all",
                }}
              >
                [{entry.time}] {entry.level.toUpperCase()}: {entry.message}
              </Typography>
              {entry.detail && (
                <Typography
                  variant="caption"
                  sx={{
                    fontSize: 10,
                    color: "text.secondary",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    pl: 1,
                  }}
                >
                  {entry.detail}
                </Typography>
              )}
            </Stack>
          ))}
        </Stack>
      </Stack>
  );
}
