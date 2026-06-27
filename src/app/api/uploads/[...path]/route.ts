import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { CONTENT_TYPES } from '@/lib/embeds';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const uploadDir = process.env.UPLOAD_DIR || './public/uploads';
  const filePath = join(process.cwd(), uploadDir, ...params.path);
  
  // Security check: ensure the path is within the upload directory
  const resolvedPath = join(process.cwd(), uploadDir);
  if (!filePath.startsWith(resolvedPath)) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  
  // Check if file exists
  if (!existsSync(filePath)) {
    return new NextResponse('Not Found', { status: 404 });
  }
  
  // Check if it's a file (not a directory)
  const stats = await stat(filePath);
  if (stats.isDirectory()) {
    return new NextResponse('Not Found', { status: 404 });
  }
  
  // Read file
  try {
    const file = await readFile(filePath);
    
    // Determine content type based on extension (shared registry).
    const ext = filePath.split('.').pop()?.toLowerCase();
    const contentType = CONTENT_TYPES[ext || ''] || 'application/octet-stream';
    
    // Cache headers
    const response = new NextResponse(file, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=2592000, immutable', // 30 days
        'X-Content-Type-Options': 'nosniff',
      },
    });
    
    return response;
  } catch (error) {
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
