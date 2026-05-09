package com.supremebot

data class ExtensionEntry(
    val id         : String,
    val name       : String,
    val description: String       = "",
    val matches    : List<String> = listOf("<all_urls>"),
    val scriptFiles: List<String> = emptyList(),
    var enabled    : Boolean      = true,
)
