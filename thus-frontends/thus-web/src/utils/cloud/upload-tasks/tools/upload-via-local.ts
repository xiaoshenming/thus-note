
import fileHelper from "~/utils/files/file-helper"
import type { LiuFileAndImage } from "~/types"
import type { 
  WhenAFileCompleted,
  UploadFileRes,
  FileReqReturn,
} from "./types"
import APIs from "~/requests/APIs"
import localCache from "~/utils/system/local-cache"
import liuEnv from "~/utils/thus-env"

export async function uploadViaLocal(
  files: LiuFileAndImage[],
  aFileCompleted: WhenAFileCompleted,
): Promise<UploadFileRes> {
  let allHasCloudUrl = true
  const env = liuEnv.getEnv()
  const domain = env.API_DOMAIN ?? "http://10.42.0.1:3000"
  // Ensure no trailing slash
  const baseUrl = domain.endsWith('/') ? domain.slice(0, -1) : domain

  for(let i=0; i<files.length; i++) {
    const v = files[i]
    const f = fileHelper.storeToFile(v)
    if(!f) {
      console.warn("failed to convert store to file")
      return "other_err"
    }

    const formData = new FormData()
    formData.append('files', f)

    // Construct headers
    const p = localCache.getPreference()
    const headers: Record<string, string> = {}
    if(p.token && p.serial) {
      headers["x-liu-token"] = p.token
      headers["x-liu-serial"] = p.serial
    }

    try {
        const res = await fetch(APIs.UPLOAD_FILE, {
            method: 'POST',
            headers,
            body: formData
        })

        if (!res.ok) {
            console.error("Local upload failed", res.status, res.statusText)
            return "network_err"
        }

        const json = await res.json()
        if (json.code === "0000" && json.data && json.data.files && json.data.files.length > 0) {
            const fileData = json.data.files[0]
            
            // Construct absolute URL for frontend display
            // fileData.url is like "/api/files/..."
            const absoluteUrl = fileData.url.startsWith('http') 
                ? fileData.url 
                : baseUrl + fileData.url

            // Construct success response compatible with Qiniu format
            const successRes: FileReqReturn = {
                code: "0000",
                data: {
                    cloud_url: absoluteUrl,
                    key: fileData.name,
                    size: fileData.size
                }
            }
            aFileCompleted(v.id, successRes)
        } else {
            console.error("Local upload business error", json)
            return "other_err"
        }

    } catch (e) {
        console.error("Local upload exception", e)
        return "network_err"
    }
  }

  return "completed"
}
