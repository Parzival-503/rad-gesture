; Presses Ctrl+CapsLock the way a person would, for tests-e2e/run.js on the
; Windows build machine. SendLevel 1 so the helper's hotkeys react to it.
;   flick: hold Ctrl+CapsLock, move straight up past the top direction, let go
;   tap:   tap Ctrl+CapsLock (ring stays open), then click the bottom direction
#NoEnv
#SingleInstance Off
SendMode Input
CoordMode, Mouse, Screen
SendLevel, 1
SetKeyDelay, 20, 20

mode := A_Args[1]
x := A_ScreenWidth // 2
y := A_ScreenHeight // 2
MouseMove, %x%, %y%, 0
Sleep, 300

if (mode = "flick") {
    Send, {Ctrl down}{CapsLock down}
    Sleep, 800
    up := y - 175
    MouseMove, %x%, %up%, 8
    Sleep, 450
    Send, {CapsLock up}{Ctrl up}
} else if (mode = "tap") {
    Send, {Ctrl down}{CapsLock down}
    Sleep, 60
    Send, {CapsLock up}{Ctrl up}
    Sleep, 900
    down := y + 120
    MouseMove, %x%, %down%, 6
    Sleep, 300
    Click
}
Sleep, 300
ExitApp
