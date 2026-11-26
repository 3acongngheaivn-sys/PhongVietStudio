Unicode true
RequestExecutionLevel user
ManifestDPIAware true
SetCompressor /SOLID lzma
SetDateSave off

!include "MUI2.nsh"
!include "x64.nsh"

!define PRODUCT "Phông Việt Studio"
!define VERSION "0.1.0"
!define PROGRAM "PhongVietStudio.exe"
!define UNINSTALLER "GoCaiDat.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\PhongVietStudio"

Name "${PRODUCT}"
Caption "Cài đặt ${PRODUCT}"
UninstallCaption "Gỡ cài đặt ${PRODUCT}"
BrandingText "${PRODUCT} ${VERSION}"
InstallDir "$LOCALAPPDATA\Programs\Phong Viet Studio"
OutFile "${SETUP_EXE}"
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1066 "ProductName" "${PRODUCT}"
VIAddVersionKey /LANG=1066 "FileDescription" "Bộ cài ${PRODUCT} cho Windows x64"
VIAddVersionKey /LANG=1066 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1066 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1066 "InternalName" "PhongVietStudioSetup"
VIAddVersionKey /LANG=1066 "LegalCopyright" ""
VIAddVersionKey /LANG=1066 "OriginalFilename" "PhongVietStudio-Setup-x64.exe"

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${PROGRAM}"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!define MUI_FINISHPAGE_RUN_TEXT "Mở Phông Việt Studio"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Vietnamese"

Var StagedProgram

Function .onInit
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "Bộ cài này dành cho Windows 64 bit." /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  SetRegView 64
FunctionEnd

Section "Phông Việt Studio" Core
  SectionIn RO
  ClearErrors
  SetOutPath "$INSTDIR"
  IfErrors write_failed
  GetTempFileName $StagedProgram "$INSTDIR"
  StrCmp $StagedProgram "" write_failed
  File "/oname=$StagedProgram" "${LAUNCHER_EXE}"
  IfErrors stage_failed

  replace_program:
    ; REPLACE_EXISTING (1) and WRITE_THROUGH (8) keep the previous program
    ; intact if Windows refuses to replace its running executable.
    System::Call 'kernel32::MoveFileExW(w "$StagedProgram", w "$INSTDIR\${PROGRAM}", i 9)i.r0'
    StrCmp $0 0 0 register
    IfSilent stage_failed
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Không thể thay tệp Phông Việt Studio.$\r$\n$\r$\nNếu Studio đang mở, chọn Thoát Studio trong ứng dụng rồi bấm Thử lại." IDRETRY replace_program
    Goto stage_failed

  register:
    ClearErrors
    WriteUninstaller "$INSTDIR\${UNINSTALLER}"
    IfErrors write_failed

    CreateShortcut "$SMPROGRAMS\${PRODUCT}.lnk" "$INSTDIR\${PROGRAM}"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${PRODUCT}"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PRODUCT}"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${PROGRAM},0"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\${UNINSTALLER}"'
    WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINSTALLER}" /S'
    WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
    WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
    IfErrors registration_failed
    Goto finish

  stage_failed:
    Delete "$StagedProgram"

  write_failed:
    IfSilent fail
    MessageBox MB_OK|MB_ICONEXCLAMATION "Cài đặt chưa hoàn tất. Hãy chọn Thoát Studio nếu ứng dụng đang mở, kiểm tra quyền ghi và thử lại." /SD IDOK
    Goto fail

  registration_failed:
    IfSilent fail
    MessageBox MB_OK|MB_ICONEXCLAMATION "Chưa đăng ký được Phông Việt Studio trong Windows. Hãy chạy lại bộ cài." /SD IDOK

  fail:
    SetErrorLevel 2
    Abort

  finish:
SectionEnd

Section /o "Lối tắt trên màn hình nền" Desktop
  SetOutPath "$INSTDIR"
  CreateShortcut "$DESKTOP\${PRODUCT}.lnk" "$INSTDIR\${PROGRAM}"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${Core} "Cài ứng dụng và thêm lối tắt vào menu Bắt đầu của tài khoản hiện tại."
  !insertmacro MUI_DESCRIPTION_TEXT ${Desktop} "Thêm lối tắt Phông Việt Studio trên màn hình nền."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Function un.onInit
  SetShellVarContext current
  SetRegView 64
FunctionEnd

Section "Uninstall"
  remove_program:
    IfFileExists "$INSTDIR\${PROGRAM}" 0 remove_registration
    Delete "$INSTDIR\${PROGRAM}"
    IfFileExists "$INSTDIR\${PROGRAM}" 0 remove_registration
    IfSilent remove_failed
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Không thể xoá tệp Phông Việt Studio.$\r$\n$\r$\nNếu Studio đang mở, chọn Thoát Studio trong ứng dụng rồi bấm Thử lại." IDRETRY remove_program

  remove_failed:
    SetErrorLevel 2
    Abort

  remove_registration:
    Delete "$SMPROGRAMS\${PRODUCT}.lnk"
    Delete "$DESKTOP\${PRODUCT}.lnk"
    DeleteRegKey HKCU "${UNINSTALL_KEY}"
    Delete "$INSTDIR\${UNINSTALLER}"
    RMDir "$INSTDIR"
SectionEnd
