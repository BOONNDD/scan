package com.supremebot

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

class ExtensionManagerActivity : AppCompatActivity() {

    private lateinit var extManager : ExtensionManager
    private lateinit var listView   : ListView
    private lateinit var emptyText  : TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        extManager = ExtensionManager(this)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(BG_DARK)
        }

        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(BG_CARD)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            gravity = Gravity.CENTER_VERTICAL
        }
        TextView(this).apply {
            text = "🧩 Extensions"
            textSize = 16f; setTextColor(GREEN)
            layoutParams = LinearLayout.LayoutParams(0, LP_WC, 1f)
            toolbar.addView(this)
        }
        Button(this).apply {
            text = "+ Add"; textSize = 12f
            setTextColor(GREEN); setBackgroundColor(0xFF1a2a1a.toInt())
            setOnClickListener { showAddDialog() }
            toolbar.addView(this)
        }
        root.addView(toolbar, LP_MW)

        emptyText = TextView(this).apply {
            text = "No extensions installed.\nTap + Add to load a ZIP / CRX or Chrome Web Store extension."
            setTextColor(0xFF666666.toInt()); textSize = 13f; gravity = Gravity.CENTER
            setPadding(dp(24), dp(40), dp(24), dp(40))
            visibility = View.GONE
        }
        root.addView(emptyText, LP_MW)

        listView = ListView(this).apply {
            setBackgroundColor(BG_DARK); divider = null
        }
        root.addView(listView, LinearLayout.LayoutParams(LP_MATCH, 0, 1f))

        setContentView(root)
        refreshList()
    }

    private fun refreshList() {
        val exts = extManager.listExtensions()
        emptyText.visibility = if (exts.isEmpty()) View.VISIBLE else View.GONE
        listView.adapter = object : BaseAdapter() {
            override fun getCount() = exts.size
            override fun getItem(i: Int) = exts[i]
            override fun getItemId(i: Int) = i.toLong()
            override fun getView(pos: Int, convert: View?, parent: ViewGroup): View {
                val ext = exts[pos]

                val row = LinearLayout(this@ExtensionManagerActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    setBackgroundColor(BG_CARD)
                    setPadding(dp(14), dp(10), dp(10), dp(10))
                    gravity = Gravity.CENTER_VERTICAL
                }

                val col = LinearLayout(this@ExtensionManagerActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    layoutParams = LinearLayout.LayoutParams(0, LP_WC, 1f)
                }
                TextView(this@ExtensionManagerActivity).apply {
                    text = ext.name; textSize = 14f; setTextColor(WHITE)
                    col.addView(this)
                }
                TextView(this@ExtensionManagerActivity).apply {
                    text = ext.matches.take(2).joinToString(", ")
                    textSize = 10f; setTextColor(0xFF777777.toInt())
                    col.addView(this)
                }

                @Suppress("DEPRECATION")
                val toggle = Switch(this@ExtensionManagerActivity).apply {
                    isChecked = ext.enabled
                    setOnCheckedChangeListener { _, on -> extManager.toggleExtension(ext.id, on) }
                }

                val delBtn = TextView(this@ExtensionManagerActivity).apply {
                    text = "🗑"; textSize = 18f
                    setTextColor(0xFFFF4444.toInt()); gravity = Gravity.CENTER
                    layoutParams = LinearLayout.LayoutParams(dp(40), dp(40))
                    setOnClickListener {
                        AlertDialog.Builder(this@ExtensionManagerActivity)
                            .setTitle("Delete ${ext.name}?")
                            .setPositiveButton("Delete") { _, _ ->
                                extManager.deleteExtension(ext.id); refreshList()
                            }
                            .setNegativeButton("Cancel", null).show()
                    }
                }

                row.addView(col); row.addView(toggle); row.addView(delBtn)

                return LinearLayout(this@ExtensionManagerActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    setBackgroundColor(BG_DARK)
                    val lp = LinearLayout.LayoutParams(LP_MATCH, LP_WC)
                    lp.setMargins(0, 0, 0, dp(1))
                    layoutParams = lp
                    addView(row)
                }
            }
        }
    }

    private fun showAddDialog() {
        AlertDialog.Builder(this)
            .setTitle("Add Extension")
            .setItems(arrayOf("📁 Load from ZIP / CRX file", "🌐 Chrome Web Store (by ID)")) { _, which ->
                if (which == 0) pickFile() else showCwsDialog()
            }
            .setNegativeButton("Cancel", null).show()
    }

    private fun pickFile() {
        startActivityForResult(
            Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf(
                    "application/zip", "application/x-zip-compressed", "application/octet-stream"
                ))
            }, REQ_PICK_FILE
        )
    }

    private fun showCwsDialog() {
        val input = EditText(this).apply {
            hint = "Extension ID  (32 chars, e.g. cjpalhdlnbpafiamejdnhcphjbkeiagm)"
            setTextColor(WHITE); setHintTextColor(0xFF555555.toInt())
            setBackgroundColor(BG_CARD); setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        AlertDialog.Builder(this)
            .setTitle("Chrome Web Store")
            .setMessage("Paste the extension ID from the CWS URL:\n…/detail/name/ID")
            .setView(input)
            .setPositiveButton("Install") { _, _ ->
                val id = input.text.toString().trim()
                if (id.length == 32) downloadCrx(id)
                else toast("Extension ID must be exactly 32 characters")
            }
            .setNegativeButton("Cancel", null).show()
    }

    private fun downloadCrx(extId: String) {
        toast("⬇️ Downloading...")
        Thread {
            try {
                val url  = CWS_DL.format(extId)
                val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
                conn.connectTimeout = 20_000; conn.readTimeout = 30_000
                conn.instanceFollowRedirects = true
                if (conn.responseCode == 200) {
                    val ext = extManager.installFromCrx(conn.inputStream)
                    runOnUiThread { toast("✅ Installed: ${ext.name}"); refreshList() }
                } else {
                    runOnUiThread { toast("❌ HTTP ${conn.responseCode}") }
                }
                conn.disconnect()
            } catch (e: Exception) {
                runOnUiThread { toast("❌ ${e.message}") }
            }
        }.start()
    }

    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_PICK_FILE || resultCode != Activity.RESULT_OK) return
        val uri = data?.data ?: return
        toast("⬇️ Installing...")
        Thread {
            try {
                val stream = contentResolver.openInputStream(uri)!!
                val isCrx  = uri.lastPathSegment?.endsWith(".crx", true) == true
                val ext    = if (isCrx) extManager.installFromCrx(stream) else extManager.installFromZip(stream)
                runOnUiThread { toast("✅ Installed: ${ext.name}"); refreshList() }
            } catch (e: Exception) {
                runOnUiThread { toast("❌ ${e.message}") }
            }
        }.start()
    }

    private fun toast(msg: String) =
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()

    companion object {
        private const val REQ_PICK_FILE = 1001
        private const val CWS_DL = "https://clients2.google.com/service/update2/crx" +
            "?response=redirect&acceptformat=crx3&prodversion=49.0" +
            "&x=id%%3D%s%%26installsource%%3Dondemand%%26uc"
        private const val BG_DARK  = 0xFF0F0F1A.toInt()
        private const val BG_CARD  = 0xFF1A1A2E.toInt()
        private const val GREEN    = 0xFF00FF88.toInt()
        private const val WHITE    = 0xFFFFFFFF.toInt()
        private const val LP_MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        private const val LP_WC    = ViewGroup.LayoutParams.WRAP_CONTENT
        private val LP_MW = LinearLayout.LayoutParams(LP_MATCH, LP_WC)
    }
}
