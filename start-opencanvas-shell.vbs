Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
root = fileSystem.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
shell.Environment("PROCESS")("AGENT_RUNTIME_MODE") = "local"
If Not fileSystem.FileExists(root & "\node_modules\.bin\electron.cmd") Then
  MsgBox "OpenCanvas Electron dependencies are missing. Run npm.cmd install in the project folder first.", 16, "OpenCanvas"
  WScript.Quit 1
End If
shell.Run "cmd.exe /c npm.cmd run shell:dev", 0, False
