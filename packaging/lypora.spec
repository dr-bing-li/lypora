# Lypora 的 RPM 打包脚本。
#
# 用法（在 Linux 上，暂存树已就绪）：
#   rpmbuild -bb \
#     --define "_version 0.6.0" \
#     --define "_stage_root $PWD/build/stage" \
#     --define "_topdir $PWD/build/rpm" \
#     packaging/lypora.spec
#   产物：build/rpm/RPMS/x86_64/lypora-<ver>-1.x86_64.rpm
#
# 为什么 %install 是 cp -a 而不是解 tar：
#   文件树由 tools/linux-stage.py 统一生成，deb / rpm / AppImage 吃的是同一棵；
#   这里再打一个 tar 只是多一层可能出错的中间物。

%{!?_version:%global _version 0.0.0}
%{!?_stage_root:%global _stage_root /nonexistent}

# 关掉 brp-strip / debuginfo：Electron 的二进制已经是 strip 过的，再 strip 一遍
# 既没收益又要装一堆 build-id 工具；顺带让构建快几十秒。
%global __os_install_post %{nil}
%global debug_package %{nil}
%global _build_id_links none

Name:           lypora
Version:        %{_version}
Release:        1%{?dist}
Summary:        Markdown editor with instant preview
License:        MIT
URL:            https://github.com/dr-bing-li/lypora
BuildArch:      x86_64
Packager:       dr-bing-li <dr-bing-li@users.noreply.github.com>

# 手动写死的是"发行版里就一定有的那几样"。剩下的 soname 依赖由 rpmbuild 的
# find-requires 从 ELF 头自动扫出来（AutoReqProv 默认开启），比自己猜更准。
Requires:       gtk3
Requires:       nss
Requires:       alsa-lib
Requires:       mesa-libgbm
Requires:       libXScrnSaver
Requires:       xdg-utils

%description
Lypora is an independent implementation of a live-preview Markdown editor:
what you type is rendered in place while the source stays editable.

Features: tables with draggable column widths, math (KaTeX), diagram fences,
seven UI languages, built-in themes plus third-party Typora theme import,
export to Markdown / HTML / PDF.

This package installs the desktop application into /opt/lypora.

%prep

%build

%install
rm -rf %{buildroot}
mkdir -p %{buildroot}
if [ ! -d "%{_stage_root}/opt/lypora" ]; then
  echo "暂存树不存在：%{_stage_root}" >&2
  echo "先跑 python3 tools/linux-stage.py --zip <electron-linux-x64.zip> --stage build/stage" >&2
  exit 1
fi
cp -a %{_stage_root}/. %{buildroot}/
# DEBIAN/ 是给 dpkg-deb 用的控制目录，不属于运行时文件
rm -rf %{buildroot}/DEBIAN

# GNU cp 以非 root 身份复制"root 属主 + setuid"的文件时会抹掉 s 位
# （它保不住属主，就不肯给你一个 setuid 文件）。rpmbuild 不是 root 跑的，
# 所以这里必须显式补回来——否则装出来的 chrome-sandbox 是 0755，
# Electron 报 "The SUID sandbox helper binary was found, but is not configured correctly"。
# 注意 %files 里**不要**再单独列这个文件，否则会和 /opt/lypora 的目录递归撞成 "File listed twice"；
# 靠这条 chmod 让 buildroot 里的 mode 变成 4755，rpm 就会照实记录。
chmod 4755 %{buildroot}/opt/lypora/chrome-sandbox

%files
/opt/lypora
/usr/bin/lypora
/usr/share/applications/lypora.desktop
/usr/share/metainfo/app.lypora.editor.metainfo.xml
/usr/share/icons/hicolor
# 目录形式的 %license / %doc：一次性把 LICENSE、LICENSES.chromium.html、LICENSE.lypora
# 都标成许可证文件。逐个列文件容易漏，漏一个 rpmbuild 就报
# "Installed (but unpackaged) file(s) found" 并让整次构建失败。
%license /usr/share/licenses/lypora
/usr/share/doc/lypora

%changelog
* Tue Nov 03 2026 dr-bing-li <dr-bing-li@users.noreply.github.com> - %{_version}-1
- First RPM build: FHS layout under /opt/lypora, /usr/bin shim, desktop entry, hicolor icons.
