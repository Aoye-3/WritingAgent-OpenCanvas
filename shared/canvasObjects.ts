export const canvasShapeIds = [
  "rectangle",
  "circle",
  "diamond",
  "triangle",
  "star",
  "arrow-right",
  "process",
  "terminator",
  "data",
  "document",
  "database",
  "hexagon",
  "speech",
  "cross",
] as const;

export type CanvasShapeId = (typeof canvasShapeIds)[number];
export const canvasTextFontSizes = [12, 16, 20, 28, 40] as const;
export type CanvasTextFontSize = (typeof canvasTextFontSizes)[number];
export const DEFAULT_CANVAS_TEXT_COLOR = "#1f2937";
export type CanvasObjectKind = "arrow" | "shape" | "table" | "asset" | "text";
export type CanvasPoint = { x: number; y: number };
export type CanvasBoxGeometry = CanvasPoint & { width: number; height: number };
export type CanvasArrowGeometry = { startX: number; startY: number; endX: number; endY: number };

type CanvasObjectBase<K extends CanvasObjectKind, G, D> = {
  id: string;
  projectId: string;
  kind: K;
  geometry: G;
  data: D;
  createdAt: string;
  updatedAt: string;
};

export type CanvasArrowObject = CanvasObjectBase<"arrow", CanvasArrowGeometry, Record<string, never>>;
export type CanvasShapeObject = CanvasObjectBase<"shape", CanvasBoxGeometry, { shapeId: CanvasShapeId }>;
export type CanvasTableObject = CanvasObjectBase<"table", CanvasBoxGeometry, { rows: string[][] }>;
export type CanvasAssetData = {
  name: string;
  extension: string;
  size: number;
  relativePath: string;
  previewable: boolean;
};
export type CanvasAssetObject = CanvasObjectBase<"asset", CanvasBoxGeometry, CanvasAssetData>;
export type CanvasTextObject = CanvasObjectBase<"text", CanvasBoxGeometry, { text: string; fontSize: CanvasTextFontSize; color: string }>;
export type CanvasObject = CanvasArrowObject | CanvasShapeObject | CanvasTableObject | CanvasAssetObject | CanvasTextObject;

export type CanvasObjectDraft =
  | (Pick<CanvasArrowObject, "kind" | "geometry" | "data"> & { id?: string })
  | (Pick<CanvasShapeObject, "kind" | "geometry" | "data"> & { id?: string })
  | (Pick<CanvasTableObject, "kind" | "geometry" | "data"> & { id?: string })
  | (Pick<CanvasTextObject, "kind" | "geometry" | "data"> & { id?: string });

export type CanvasObjectPatch = {
  kind?: CanvasObjectKind;
  geometry?: CanvasArrowGeometry | CanvasBoxGeometry;
  data?: Record<string, never> | { shapeId: CanvasShapeId } | { rows: string[][] } | CanvasTextObject["data"];
};
export type StoredCanvasObject = Omit<CanvasObject, "kind" | "geometry" | "data"> & {
  kind: unknown;
  geometry: unknown;
  data: unknown;
};

const defaultRows = () => Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ""));
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown, label: string) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
};
const positive = (value: unknown, label: string, fallback: number) => value === undefined ? fallback : Math.max(1, finite(value, label));
const coordinate = (record: Record<string, unknown>, key: string, fallback = 0) => record[key] === undefined ? fallback : finite(record[key], key);

export function isCanvasShapeId(value: unknown): value is CanvasShapeId {
  return typeof value === "string" && (canvasShapeIds as readonly string[]).includes(value);
}

export function createCanvasObjectDraft(kind: "shape" | "table" | "text", point: CanvasPoint, shapeId: CanvasShapeId = "rectangle"): CanvasObjectDraft {
  if (kind === "shape") {
    return { kind, geometry: { ...point, width: 220, height: 140 }, data: { shapeId } };
  }
  if (kind === "text") {
    return { kind, geometry: { ...point, width: 320, height: 40 }, data: { text: "", fontSize: 16, color: DEFAULT_CANVAS_TEXT_COLOR } };
  }
  return { kind, geometry: { ...point, width: 360, height: 180 }, data: { rows: defaultRows() } };
}

export function validateCanvasObjectWrite(input: { kind: unknown; geometry?: unknown; data?: unknown }): CanvasObjectDraft {
  if (input.kind === "asset") throw new Error("Asset objects must be created through the Canvas asset upload endpoint");
  if (input.kind === "arrow") {
    const geometry = requireRecord(input.geometry, "Arrow geometry");
    return {
      kind: "arrow",
      geometry: {
        startX: finite(geometry.startX, "startX"),
        startY: finite(geometry.startY, "startY"),
        endX: finite(geometry.endX, "endX"),
        endY: finite(geometry.endY, "endY"),
      },
      data: {},
    };
  }
  if (input.kind === "shape") {
    const data = requireRecord(input.data, "Shape data");
    if (!isCanvasShapeId(data.shapeId)) throw new Error("Invalid Canvas shape id");
    return { kind: "shape", geometry: strictBox(input.geometry), data: { shapeId: data.shapeId } };
  }
  if (input.kind === "table") {
    const data = requireRecord(input.data, "Table data");
    if (!isStringGrid(data.rows)) throw new Error("Invalid Canvas table rows");
    return { kind: "table", geometry: strictBox(input.geometry), data: { rows: data.rows } };
  }
  if (input.kind === "text") {
    const data = requireRecord(input.data, "Text data");
    if (typeof data.text !== "string") throw new Error("Canvas text must be a string");
    if (!isCanvasTextFontSize(data.fontSize)) throw new Error("Invalid Canvas text font size");
    if (!isHexColor(data.color)) throw new Error("Invalid Canvas text color");
    return { kind: "text", geometry: strictBox(input.geometry), data: { text: data.text, fontSize: data.fontSize, color: data.color } };
  }
  throw new Error("Invalid Canvas object kind");
}

export function normalizeStoredCanvasObject(input: StoredCanvasObject): CanvasObject {
  const base = { id: input.id, projectId: input.projectId, createdAt: input.createdAt, updatedAt: input.updatedAt };
  const geometry = isRecord(input.geometry) ? input.geometry : {};
  const data = isRecord(input.data) ? input.data : {};
  if (input.kind === "arrow") {
    return {
      ...base,
      kind: "arrow",
      geometry: {
        startX: safeNumber(geometry.startX),
        startY: safeNumber(geometry.startY),
        endX: safeNumber(geometry.endX, 160),
        endY: safeNumber(geometry.endY, 80),
      },
      data: {},
    };
  }
  if (input.kind === "table") {
    return { ...base, kind: "table", geometry: compatibleBox(geometry, 360, 180), data: { rows: isStringGrid(data.rows) ? data.rows : defaultRows() } };
  }
  if (input.kind === "asset") {
    return {
      ...base,
      kind: "asset",
      geometry: compatibleBox(geometry, 260, 180),
      data: {
        name: typeof data.name === "string" ? data.name : "Asset",
        extension: typeof data.extension === "string" ? data.extension : "",
        size: safeNumber(data.size),
        relativePath: typeof data.relativePath === "string" ? data.relativePath : "",
        previewable: data.previewable === true,
      },
    };
  }
  if (input.kind === "text") {
    return {
      ...base,
      kind: "text",
      geometry: compatibleBox(geometry, 320, 40),
      data: {
        text: typeof data.text === "string" ? data.text : "",
        fontSize: isCanvasTextFontSize(data.fontSize) ? data.fontSize : 16,
        color: isHexColor(data.color) ? data.color : DEFAULT_CANVAS_TEXT_COLOR,
      },
    };
  }
  const legacyShapeId = data.shapeId ?? data.shape;
  return {
    ...base,
    kind: "shape",
    geometry: compatibleBox(geometry, 220, 140),
    data: { shapeId: isCanvasShapeId(legacyShapeId) ? legacyShapeId : "rectangle" },
  };
}

export function createStoredCanvasAsset(input: Omit<CanvasAssetObject, "kind">): CanvasAssetObject {
  return { ...input, kind: "asset", geometry: strictBox(input.geometry), data: input.data };
}

function requireRecord(value: unknown, label: string) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function strictBox(value: unknown): CanvasBoxGeometry {
  const geometry = requireRecord(value, "Canvas object geometry");
  return {
    x: finite(geometry.x, "x"),
    y: finite(geometry.y, "y"),
    width: positive(geometry.width, "width", 220),
    height: positive(geometry.height, "height", 140),
  };
}

function compatibleBox(value: Record<string, unknown>, width: number, height: number): CanvasBoxGeometry {
  return {
    x: coordinate(value, "x"),
    y: coordinate(value, "y"),
    width: positiveCompatible(value.width, width),
    height: positiveCompatible(value.height, height),
  };
}

function safeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveCompatible(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isStringGrid(value: unknown): value is string[][] {
  return Array.isArray(value) && value.length > 0 && value.every((row) => Array.isArray(row) && row.length > 0 && row.every((cell) => typeof cell === "string"));
}

function isCanvasTextFontSize(value: unknown): value is CanvasTextFontSize {
  return typeof value === "number" && (canvasTextFontSizes as readonly number[]).includes(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}
