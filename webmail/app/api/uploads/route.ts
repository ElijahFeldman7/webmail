import { route } from "@/lib/server/api";
import { config } from "@/lib/server/config";
import { saveUpload } from "@/lib/server/compose";
import { BadRequest } from "@/lib/server/mail";

export const POST = route(async (req, s) => {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > config.maxAttachmentBytes + 1024 * 1024) throw new BadRequest("Attachments can be up to 25 MB.");
  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") throw new BadRequest("No file");
  const data = Buffer.from(await file.arrayBuffer());
  return saveUpload(s.username, file.name, file.type || "application/octet-stream", data);
});
