!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${IfNot} ${Silent}
      StrCmp $APPDATA "" pako_keep_data
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Keep your data?$\r$\n$\r$\nYes keeps your PAKO database, settings and the backups in $APPDATA\PAKO, so a later install finds them again.$\r$\n$\r$\nNo permanently deletes that folder, including the backups stored in it. Backups you saved in another folder are not touched." /SD IDYES IDNO pako_delete_data
      Goto pako_keep_data
      pako_delete_data:
        RMDir /r "$APPDATA\PAKO"
      pako_keep_data:
    ${EndIf}
  ${endIf}
!macroend
