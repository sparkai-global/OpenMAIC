import { type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import {
  buildRequestOrigin,
  isValidClassroomId,
  persistClassroom,
  readClassroom,
} from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom API');

export async function POST(request: NextRequest) {
  let stageId: string | undefined;
  let sceneCount: number | undefined;
  try {
    const body = await request.json();
    const { stage, scenes } = body;
    stageId = stage?.id;
    sceneCount = scenes?.length;

    if (!stage || !scenes) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields: stage, scenes',
      );
    }

    const id = stage.id || randomUUID();
    const baseUrl = buildRequestOrigin(request);

    const persisted = await persistClassroom({ id, stage: { ...stage, id }, scenes }, baseUrl);

    return apiSuccess({ id: persisted.id, url: persisted.url }, 201);
  } catch (error) {
    log.error(
      `Classroom storage failed [stageId=${stageId ?? 'unknown'}, scenes=${sceneCount ?? 0}]:`,
      error,
    );
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

    if (!isValidClassroomId(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }

    const classroom = await readClassroom(id);
    if (!classroom) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    return apiSuccess({ classroom });
  } catch (error) {
    log.error(
      `Classroom retrieval failed [id=${request.nextUrl.searchParams.get('id') ?? 'unknown'}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * DELETE /api/classroom?id=<classroomId>&sceneId=<sceneId>
 *
 * Remove a single scene from a persisted classroom. The remaining scenes
 * have their `order` field renumbered to stay contiguous (1, 2, 3, ...),
 * and `stage.updatedAt` is bumped. Media files referenced by the deleted
 * scene (OSS audio / image / video) are intentionally NOT cleaned up —
 * removal is purely a JSON-level operation, leaving OSS files as orphans
 * for safety (no irreversible delete by accident).
 */
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  const sceneId = request.nextUrl.searchParams.get('sceneId');

  try {
    if (!id || !sceneId) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required parameters: id and sceneId',
      );
    }

    if (!isValidClassroomId(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }

    const classroom = await readClassroom(id);
    if (!classroom) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    const targetIdx = classroom.scenes.findIndex((s) => s.id === sceneId);
    if (targetIdx === -1) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Scene not found in classroom');
    }

    // Remove the scene; renumber remaining scenes so order stays 1..N.
    const remainingScenes = classroom.scenes
      .filter((s) => s.id !== sceneId)
      .map((s, i) => ({ ...s, order: i + 1 }));

    // Bump stage.updatedAt so clients can detect the change.
    const updatedStage = { ...classroom.stage, updatedAt: Date.now() };

    const baseUrl = buildRequestOrigin(request);
    await persistClassroom(
      { id: classroom.id, stage: updatedStage, scenes: remainingScenes },
      baseUrl,
    );

    log.info(
      `Scene deleted [classroomId=${id}, sceneId=${sceneId}, remaining=${remainingScenes.length}]`,
    );

    return apiSuccess({
      deletedSceneId: sceneId,
      remainingCount: remainingScenes.length,
    });
  } catch (error) {
    log.error(
      `Scene deletion failed [classroomId=${id ?? 'unknown'}, sceneId=${sceneId ?? 'unknown'}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to delete scene',
      error instanceof Error ? error.message : String(error),
    );
  }
}
