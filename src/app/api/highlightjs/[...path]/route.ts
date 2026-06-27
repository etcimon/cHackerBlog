/**
 * API endpoint to serve highlight.js CSS and JS files from node_modules.
 * This allows dynamic loading of highlight.js resources without exposing
 * the node_modules directory directly.
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const filePath = path.join("/");

  // Security: ensure the path doesn't escape node_modules/highlight.js
  if (filePath.includes("..") || filePath.includes("\\")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    // Resolve the file path from node_modules/highlight.js
    const fullPath = join(process.cwd(), "node_modules", "highlight.js", filePath);

    // Read the file
    const fileContent = await readFile(fullPath);

    // Determine content type based on file extension
    const ext = filePath.split(".").pop();
    const contentTypeMap: Record<string, string> = {
      js: "application/javascript",
      css: "text/css",
      json: "application/json",
    };
    const contentType = contentTypeMap[ext || ""] || "application/octet-stream";

    // Return the file with appropriate headers
    return new NextResponse(fileContent, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable", // Cache for 1 year
      },
    });
  } catch (error) {
    console.error(`Failed to serve highlight.js file: ${filePath}`, error);
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
