import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';

const DATA_DIR = path.join(process.cwd(), 'data', 'classrooms');

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { stage, scenes } = body;

    if (!stage || !scenes) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields: stage, scenes',
      );
    }

    const id = stage.id || randomUUID();
    const data = {
      id,
      stage: { ...stage, id },
      scenes,
      createdAt: new Date().toISOString(),
    };

    await ensureDataDir();
    const filePath = path.join(DATA_DIR, `${id}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');

    const baseUrl = request.headers.get('x-forwarded-host')
      ? `${request.headers.get('x-forwarded-proto') || 'http'}://${request.headers.get('x-forwarded-host')}`
      : request.nextUrl.origin;

    return apiSuccess({ id, url: `${baseUrl}/classroom/${id}` }, 201);
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to store classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');

    if (!id) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required parameter: id',
      );
    }

    // Validate id to prevent path traversal
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }

    const filePath = path.join(DATA_DIR, `${id}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      return apiSuccess({ classroom: data });
    } catch {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}
