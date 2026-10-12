#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
手动执行 react-native-android-widget 的 config plugin 等效操作。
为什么要手写：本机环境里 expo prebuild 的 safe-delete shim 会拦掉
「清理/复制 android 目录」这步（genie-trash 超时 / state lock timeout），
prebuild 永远跑不完 → 小组件的 receiver / appwidget-provider XML 注入不了。
这个脚本严格复刻 node_modules/react-native-android-widget/app.plugin.js 的产物：
  1) AndroidManifest: <service RNWidgetCollectionService> + 每个 widget 一个 <receiver>
  2) res/xml/widgetprovider_<name>.xml
  3) java/<pkg>/widget/<Name>.java（extends RNWidgetProvider）
  4) strings.xml 加 widget_<name>_description
配套：versionCode 2->3、app_name 改成 JUST、新插件（overlay 的 CaptureDialogActivity
     走 modules/overlay 的 library manifest，不需要在这里加）。
可重复执行（幂等）。
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = "com.aiyuexi.aischedule"
APP = os.path.join(ROOT, "android", "app")
MAIN = os.path.join(APP, "src", "main")
MANIFEST = os.path.join(MAIN, "AndroidManifest.xml")
STRINGS = os.path.join(MAIN, "res", "values", "strings.xml")
XML_DIR = os.path.join(MAIN, "res", "xml")
JAVA_WIDGET_DIR = os.path.join(MAIN, "java", PKG.replace(".", os.sep), "widget")
BUILD_GRADLE = os.path.join(APP, "build.gradle")
APP_NAME = "JUST"
VERSION_CODE = 3


def load_widgets():
    with open(os.path.join(ROOT, "app.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    plugins = cfg["expo"]["plugins"]
    for p in plugins:
        if isinstance(p, list) and p and p[0] == "react-native-android-widget":
            return p[1].get("widgets", [])
    raise SystemExit("app.json 里找不到 react-native-android-widget 插件配置")


def receiver_package(widget):
    wp = widget.get("packageName")
    return wp if wp else PKG + ".widget"


def receiver_name(widget):
    return receiver_package(widget).replace(PKG, "") + "." + widget["name"]


def gen_provider_xml(w):
    def num(key):
        return '    android:%s="%s"' % (key, w[key]) if w.get(key) else ""
    desc = '    android:description="@string/widget_%s_description"' % w["name"].lower() if w.get("description") else ""
    feat = '    android:configure="%s.WidgetConfigurationActivity"\n    android:widgetFeatures="%s"' % (PKG, w["widgetFeatures"]) if w.get("widgetFeatures") else ""
    period = max(30 * 60 * 1000, w.get("updatePeriodMillis") or 0)
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    android:minWidth="%s"\n'
        '    android:minHeight="%s"\n'
        '%s\n%s\n%s\n%s\n\n'
        '    android:resizeMode="%s"\n\n'
        '%s\n\n'
        '    android:initialLayout="@layout/rn_widget"\n\n'
        '    android:updatePeriodMillis="%s"\n'
        '    android:widgetCategory="home_screen">\n'
        '</appwidget-provider>\n'
    ) % (
        w.get("minWidth", ""), w.get("minHeight", ""),
        num("targetCellWidth"), num("targetCellHeight"),
        num("maxResizeWidth"), num("maxResizeHeight"),
        w.get("resizeMode") or "none", desc, period,
    )


def gen_provider_java(w):
    p = receiver_package(w)
    return (
        "package %s;\n\n"
        "import com.reactnativeandroidwidget.RNWidgetProvider;\n\n"
        "public class %s extends RNWidgetProvider {\n}\n"
    ) % (p, w["name"])


def gen_manifest_fragment(w):
    rp = receiver_package(w)
    rn = receiver_name(w)
    label = w.get("label") or w["name"]
    prov = "@xml/widgetprovider_%s" % w["name"].lower()
    ind = "    "
    parts = []
    parts.append('%s<receiver android:name="%s" android:exported="false" android:label="%s">' % (ind, rn, label))
    parts.append('%s  <intent-filter>' % ind)
    parts.append('%s    <action android:name="android.appwidget.action.APPWIDGET_UPDATE"/>' % ind)
    parts.append('%s    <action android:name="%s.WIDGET_CLICK"/>' % (ind, PKG))
    parts.append('%s  </intent-filter>' % ind)
    parts.append('%s  <meta-data android:name="android.appwidget.provider" android:resource="%s"/>' % (ind, prov))
    parts.append('%s</receiver>' % ind)
    return "\n".join(parts)


def main():
    widgets = load_widgets()
    print("widgets:", [w["name"] for w in widgets])

    # 1) provider XML
    os.makedirs(XML_DIR, exist_ok=True)
    for w in widgets:
        path = os.path.join(XML_DIR, "widgetprovider_%s.xml" % w["name"].lower())
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(gen_provider_xml(w))
        print("  xml:", os.path.relpath(path, ROOT))

    # 2) provider java
    os.makedirs(JAVA_WIDGET_DIR, exist_ok=True)
    for w in widgets:
        path = os.path.join(JAVA_WIDGET_DIR, "%s.java" % w["name"])
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(gen_provider_java(w))
        print("  java:", os.path.relpath(path, ROOT))

    # 3) strings.xml description
    with open(STRINGS, encoding="utf-8") as f:
        s = f.read()
    for w in widgets:
        if not w.get("description"):
            continue
        name = "widget_%s_description" % w["name"].lower()
        if name in s:
            continue
        desc = w["description"].replace("'", "\\'")
        line = '  <string name="%s" translatable="false">%s</string>\n' % (name, desc)
        s = s.replace("</resources>", line + "</resources>")
    # app_name -> JUST
    s = re.sub(r'(<string name="app_name">)[^<]*(</string>)', r"\1%s\2" % APP_NAME, s)
    with open(STRINGS, "w", encoding="utf-8", newline="\n") as f:
        f.write(s)
    print("  strings.xml updated (app_name=%s)" % APP_NAME)

    # 4) AndroidManifest: service + receivers
    with open(MANIFEST, encoding="utf-8") as f:
        m = f.read()

    SERVICE = (
        '    <service android:name="com.reactnativeandroidwidget.RNWidgetCollectionService"'
        ' android:permission="android.permission.BIND_REMOTEVIEWS"/>'
    )
    if "RNWidgetCollectionService" not in m:
        m = m.replace("</application>", SERVICE + "\n</application>")

    add = []
    for w in widgets:
        rn = receiver_name(w)
        if ('android:name="%s"' % rn) in m:
            continue
        add.append(gen_manifest_fragment(w))
    if add:
        m = m.replace("</application>", "\n".join(add) + "\n  </application>")
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        f.write(m)
    print("  AndroidManifest updated (+service, +%d receivers)" % len(add))

    # 5) build.gradle versionCode
    with open(BUILD_GRADLE, encoding="utf-8") as f:
        g = f.read()
    g2 = re.sub(r"versionCode\s+\d+", "versionCode %d" % VERSION_CODE, g)
    with open(BUILD_GRADLE, "w", encoding="utf-8", newline="\n") as f:
        f.write(g2)
    print("  build.gradle versionCode -> %d" % VERSION_CODE)

    print("done.")


if __name__ == "__main__":
    main()
