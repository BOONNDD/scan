package com.supremebot

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.*
import java.util.zip.ZipInputStream

class ExtensionManager(private val context: Context) {

    private val extDir: File
        get() = File(context.filesDir, "extensions").also { it.mkdirs() }

    // ── Public API ────────────────────────────────────────────────────────────

    /** Install extension from a ZIP stream. Returns the installed entry. */
    fun installFromZip(stream: InputStream): ExtensionEntry {
        val tempDir = File(extDir, "_tmp_${System.currentTimeMillis()}")
        tempDir.mkdirs()
        try {
            extractZip(stream, tempDir)
            val manifest = findManifest(tempDir)
            val baseDir  = manifest.parentFile ?: tempDir
            val ext      = parseManifest(manifest, baseDir, tempDir)
            val finalDir = File(extDir, ext.id)
            if (finalDir.exists()) finalDir.deleteRecursively()
            tempDir.renameTo(finalDir)
            saveMeta(ext)
            return ext
        } catch (e: Exception) {
            tempDir.deleteRecursively()
            throw e
        }
    }

    /**
     * Install extension from a CRX stream.
     * CRX3 layout: magic(4) + version(4) + headerSize(4) + header(N) + zip
     * CRX2 layout: magic(4) + version(4) + pubKeyLen(4) + sigLen(4) + key + sig + zip
     */
    fun installFromCrx(stream: InputStream): ExtensionEntry {
        val bytes = stream.readBytes()
        if (bytes.size < 16) throw IllegalArgumentException("CRX file too small")
        val magic = String(bytes.sliceArray(0..3))
        if (magic != "Cr24") throw IllegalArgumentException("Not a valid CRX file (bad magic)")
        val version = bytes.leInt(4)
        val zipStart = if (version == 3) {
            12 + bytes.leInt(8)
        } else {
            // CRX2
            16 + bytes.leInt(8) + bytes.leInt(12)
        }
        if (zipStart >= bytes.size) throw IllegalArgumentException("CRX header extends past file end")
        return installFromZip(ByteArrayInputStream(bytes.sliceArray(zipStart until bytes.size)))
    }

    /** Returns list of (extensionName, jsContent) for all enabled extensions matching the URL. */
    fun getScriptsForUrl(url: String): List<Pair<String, String>> {
        return listExtensions()
            .filter { it.enabled && urlMatchesAny(url, it.matches) }
            .flatMap { ext ->
                ext.scriptFiles.mapNotNull { rel ->
                    val f = File(File(extDir, ext.id), rel)
                    if (f.exists()) Pair(ext.name, f.readText()) else null
                }
            }
    }

    fun listExtensions(): List<ExtensionEntry> {
        val meta = File(extDir, "meta.json")
        if (!meta.exists()) return emptyList()
        return try {
            val arr = JSONArray(meta.readText())
            (0 until arr.length()).map { parseEntry(arr.getJSONObject(it)) }
        } catch (_: Exception) { emptyList() }
    }

    fun toggleExtension(id: String, enabled: Boolean) {
        val list = listExtensions().map {
            if (it.id == id) it.copy(enabled = enabled) else it
        }
        saveAll(list)
    }

    fun deleteExtension(id: String) {
        File(extDir, id).deleteRecursively()
        saveAll(listExtensions().filter { it.id != id })
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    private fun extractZip(stream: InputStream, destDir: File) {
        ZipInputStream(BufferedInputStream(stream)).use { zis ->
            var entry = zis.nextEntry
            while (entry != null) {
                val dest = File(destDir, entry.name)
                // Guard against zip-slip path traversal
                if (!dest.canonicalPath.startsWith(destDir.canonicalPath + File.separator)) {
                    entry = zis.nextEntry
                    continue
                }
                if (entry.isDirectory) {
                    dest.mkdirs()
                } else {
                    dest.parentFile?.mkdirs()
                    dest.outputStream().buffered().use { out -> zis.copyTo(out) }
                }
                entry = zis.nextEntry
            }
        }
    }

    private fun findManifest(dir: File): File {
        File(dir, "manifest.json").let { if (it.exists()) return it }
        dir.listFiles()?.filter { it.isDirectory }?.forEach { sub ->
            File(sub, "manifest.json").let { if (it.exists()) return it }
        }
        throw IllegalArgumentException("manifest.json not found in ZIP")
    }

    private fun parseManifest(manifest: File, baseDir: File, rootDir: File): ExtensionEntry {
        val json  = JSONObject(manifest.readText())
        val name  = json.optString("name", "Extension")
        val desc  = json.optString("description", "")
        val id    = name.lowercase().replace(Regex("[^a-z0-9]"), "_") +
                    "_" + System.currentTimeMillis().toString().takeLast(6)

        val matches     = mutableListOf<String>()
        val scriptFiles = mutableListOf<String>()

        val cs = json.optJSONArray("content_scripts")
        if (cs != null) {
            for (i in 0 until cs.length()) {
                val obj = cs.getJSONObject(i)
                obj.optJSONArray("matches")?.let { ma ->
                    for (j in 0 until ma.length()) matches.add(ma.getString(j))
                }
                obj.optJSONArray("js")?.let { js ->
                    for (j in 0 until js.length()) scriptFiles.add(js.getString(j))
                }
            }
        }

        // Fallback: inject all .js files on all URLs
        if (scriptFiles.isEmpty()) {
            baseDir.walk()
                .filter { it.isFile && it.extension == "js" }
                .forEach { scriptFiles.add(it.relativeTo(baseDir).path) }
            if (matches.isEmpty()) matches.add("<all_urls>")
        }

        return ExtensionEntry(id, name, desc, matches, scriptFiles)
    }

    private fun urlMatchesAny(url: String, patterns: List<String>): Boolean {
        for (p in patterns) {
            if (p == "<all_urls>") return true
            try {
                val rx = p
                    .replace(".", "\\.")
                    .replace("*://", "[a-z]+://")
                    .replace("/*", "/.*")
                    .replace("*.", ".*\\.")
                if (Regex(rx).containsMatchIn(url)) return true
            } catch (_: Exception) {}
        }
        return false
    }

    private fun saveMeta(ext: ExtensionEntry) {
        val list = listExtensions().toMutableList()
        list.removeAll { it.id == ext.id }
        list.add(ext)
        saveAll(list)
    }

    private fun saveAll(list: List<ExtensionEntry>) {
        val arr = JSONArray()
        for (e in list) arr.put(JSONObject().apply {
            put("id",          e.id)
            put("name",        e.name)
            put("description", e.description)
            put("enabled",     e.enabled)
            put("matches",     JSONArray(e.matches))
            put("scriptFiles", JSONArray(e.scriptFiles))
        })
        File(extDir, "meta.json").writeText(arr.toString())
    }

    private fun parseEntry(obj: JSONObject): ExtensionEntry {
        fun jsonArr(key: String) = obj.optJSONArray(key)?.let { a ->
            (0 until a.length()).map { a.getString(it) }
        } ?: emptyList()
        return ExtensionEntry(
            obj.getString("id"),
            obj.getString("name"),
            obj.optString("description", ""),
            jsonArr("matches"),
            jsonArr("scriptFiles"),
            obj.optBoolean("enabled", true),
        )
    }

    private fun ByteArray.leInt(offset: Int): Int =
        (this[offset].toInt() and 0xFF) or
        ((this[offset + 1].toInt() and 0xFF) shl 8) or
        ((this[offset + 2].toInt() and 0xFF) shl 16) or
        ((this[offset + 3].toInt() and 0xFF) shl 24)
}
