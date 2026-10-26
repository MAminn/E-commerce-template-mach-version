import { redirect } from "vike/abort";
import { getLandingPageEditorState } from "#root/backend/landing-page/service";
import {
  runBackendEffect,
  serializeBackendEffectResult,
} from "#root/shared/backend/effect";
import { canEditLandingPage } from "#root/shared/landing-page/config";
import { provideDatabase } from "#root/shared/trpc/server";

/**
 * The saved content, server-rendered so the editor opens filled in.
 *
 * Also replaces the dashboard overview loader this page would otherwise
 * inherit, which is admin-only and would send a media buyer away.
 */
export async function data(ctx: Vike.PageContext) {
  if (!canEditLandingPage(ctx.clientSession?.role)) {
    throw redirect("/");
  }
  return runBackendEffect(
    getLandingPageEditorState().pipe(provideDatabase({ db: ctx.db })),
  ).then(serializeBackendEffectResult);
}

export type Data = Awaited<ReturnType<typeof data>>;
