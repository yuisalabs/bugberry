import type { Db } from "../../db/client"
import { conflict } from "../../lib/errors"
import { findProjectBySlug, type ProjectRow } from "./repository"

/** Slugs are unique within a workspace. */
export async function assertSlugFree(db: Db, workspaceId: string, slug: string, exceptId?: string): Promise<void> {
  const existing = await findProjectBySlug(db, workspaceId, slug)
  if (existing && existing !== exceptId) throw conflict("slug_taken", "Slug is already used by another project")
}

/** A project as the API shows it; its AI default template is read and set through /workspaces/:id/ai. */
export const projectView = ({ aiTemplateId: _aiTemplateId, ...row }: ProjectRow) => row
