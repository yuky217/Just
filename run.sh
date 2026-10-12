#!/usr/bin/env bash
# 项目内命令入口：Bash 工具不继承 cwd，npx 必须在项目根执行（2026-10-08）
# 用法: bash run.sh <tsc|test|apk|vitest...>
cd "$(dirname "$0")" || exit 1
export npm_config_cache="D:/艾粤希/.npm-cache"
export HOME="D:/艾粤希/.expo-home"
export EXPO_NO_TELEMETRY=1
CMD="$1"
shift
case "$CMD" in
  tsc) exec npx tsc --noEmit "$@" ;;
  test) exec npx vitest run "$@" ;;
  # 出 APK：Windows 路径不能含中文（clang/ninja/prefab 都按 GBK 读 UTF-8 会乱码），
  # 所以项目必须放在纯 ASCII 路径下构建。全套 env 缺一不可，逐条理由见下面注释。
  # ⚠️ 必须 assembleRelease（2026-10-08 教训）：debug 包**不内嵌 JS bundle**，
  # 装到手机上会去找 Metro 开发服务器 —— 没有 Metro 就永远卡在蓝底启动屏。
  # release 包才把 JS 编进 APK（assets/index.android.bundle），离线可跑。
  # 签名用的是 debug keystore（build.gradle 里 release 段就这么配的），个人安装够用。
  apk)
    # PATH 里的 node 是 22.22.2，跑 prebuild 会 0xC0000409 崩，必须用 24
    export PATH="D:/node:$PATH"
    # gradle 缓存/TEMP 若落在 C:\Users\艾粤希（中文）→ prefab 生成的 .bat 乱码
    export GRADLE_USER_HOME="D:/gradle-home"
    export TMP="D:/tmp-build" TEMP="D:/tmp-build"
    export ANDROID_HOME="D:/Android/Sdk"
    # which java 拿到的是 Oracle javapath shim，dirname 会得到错目录，直接写死
    export JAVA_HOME="D:/java_JDK"
    # ⚠️ 内存红线（2026-10-12 教训，务必别改回去）：
    # 这台机器是 i5-8250U / 8 核 / 16GB。ninja 默认并行 = 核数+2 = **10 个 clang++**，
    # 而 RN 0.86 的 C++（folly/reanimated/screens 那堆模板）单个就要 1GB+，
    # 10 个一起上直接吃光物理内存 → clang 报 0x8「内存资源不足」，
    # 连 Gradle 守护进程都被挤崩（hs_err 里是 malloc failed / commit metaspace failed）。
    # 症状极具迷惑性：报的是"C/C++ 编译失败"，其实是内存不够。
    # CMAKE_BUILD_PARALLEL_LEVEL 把单个 ninja 的 job 数压到 2，--max-workers 把
    # 并发的 Gradle 任务压到 2。慢一点，但这是能出包的唯一配置。
    export CMAKE_BUILD_PARALLEL_LEVEL=2
    # ⚠️ 只出 arm64-v8a 单架构（2026-10-12 教训）：
    # gradle.properties 里 reactNativeArchitectures 默认 4 个 ABI 全编 ——
    # 那等于把上面的内存压力再乘 4（4 套 native 库、4 次 ninja），
    # 16GB 机器必炸。用户的手机是 arm64（Mate 70 Pro），只出这一个就够了，
    # 包还小一大截。要出全架构时手工加 -PreactNativeArchitectures=... 覆盖即可。
    # ⚠️ --no-parallel：不让多个模块的 native 编译同时跑。
    # AGP 自己接管了 ninja 的 -j（CMAKE_BUILD_PARALLEL_LEVEL 会被忽略，实测仍起 10 个 clang），
    # 所以唯一能压住峰值内存的办法就是**同一时刻只让一个 ninja 存在**。
    # ⚠️ 2026-10-12 追记：之前这里绕开 wrapper 直调发行版 gradle.bat，理由是
    # "gradle-9.3.1-bin.zip.lck 被文件钩子卡成拒绝访问"。**那个归因是错的**：
    # 当时会话处于只读模式，所有派生进程都被禁止改写已存在文件 → 加锁失败。
    # 切到可写模式后 `./gradlew --version` 与整包构建都正常，故改回标准 wrapper。
    cd android || exit 1
    exec ./gradlew assembleRelease --no-daemon -x lint --max-workers=2 --no-parallel \
      -PreactNativeArchitectures=arm64-v8a "$@" ;;
  apk-debug)
    # 只给"连着电脑跑 Metro 调试"用：npx expo start 起服务器，debug 包才有东西可加载
    export PATH="D:/node:$PATH"
    export GRADLE_USER_HOME="D:/gradle-home"
    export TMP="D:/tmp-build" TEMP="D:/tmp-build"
    export ANDROID_HOME="D:/Android/Sdk"
    export JAVA_HOME="D:/java_JDK"
    # 同 apk：这台机器只有 16GB，ninja 默认并发会把内存吃光
    export CMAKE_BUILD_PARALLEL_LEVEL=2
    cd android || exit 1
    exec ./gradlew assembleDebug --no-daemon -x lint --max-workers=2 "$@" ;;
  *) exec "$CMD" "$@" ;;
esac

