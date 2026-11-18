import { getListener } from "@/lib/auth";
import { artistArtwork } from "@/lib/artist-artwork";
import { isAlbumId } from "@/lib/catalog";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isAlbumId(id)) return new Response(null, { status: 404 });
  if (!(await getListener())) return new Response(null, { status: 401 });
  try {
    const image = await artistArtwork(id.toLowerCase());
    return Response.json(image, { headers: { "Cache-Control": "private, max-age=86400" } });
  } catch {
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
