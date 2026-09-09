// ApplicationLoopback.cpp : This file contains the 'main' function. Program execution begins and ends there.
//

#include <Windows.h>
#include <stdlib.h>
#include <iostream>
#include "LoopbackCapture.h"

// Everything informational goes to stderr; stdout is reserved for captured audio.
void usage()
{
    std::wcerr <<
        L"Usage: ApplicationLoopback <pid|hwnd:HANDLE> <includetree|excludetree> <outputfilename|->\n"
        L"\n"
        L"<pid> is the process ID to capture or exclude from capture\n"
        L"hwnd:HANDLE targets the process that owns the given window handle instead\n"
        L"includetree includes audio from that process and its child processes\n"
        L"excludetree includes audio from all processes except that process and its child processes\n"
        L"<outputfilename> is the WAV file to receive the captured audio\n"
        L"- streams a JSON format line followed by raw PCM on stdout until terminated\n"
        L"\n"
        L"Examples:\n"
        L"\n"
        L"ApplicationLoopback 1234 includetree CapturedAudio.wav\n"
        L"\n"
        L"  Captures audio from process 1234 and its children.\n"
        L"\n"
        L"ApplicationLoopback 1234 includetree -\n"
        L"\n"
        L"  Streams audio from process 1234 and its children on stdout.\n"
        L"\n"
        L"ApplicationLoopback 1234 excludetree CapturedAudio.wav\n"
        L"\n"
        L"  Captures audio from all processes except process 1234 and its children.\n";
}

int wmain(int argc, wchar_t* argv[])
{
    if (argc != 4)
    {
        usage();
        return 1;
    }

    // A window handle is accepted in place of a pid so callers that only know which window
    // they are capturing do not have to match on window titles, which are ambiguous.
    DWORD processId = 0;
    if (_wcsnicmp(argv[1], L"hwnd:", 5) == 0)
    {
        HWND window = reinterpret_cast<HWND>(static_cast<INT_PTR>(_wcstoi64(argv[1] + 5, nullptr, 0)));
        if (!IsWindow(window))
        {
            std::wcerr << L"Window " << argv[1] + 5 << L" no longer exists.\n";
            return 1;
        }
        GetWindowThreadProcessId(window, &processId);
        std::wcerr << L"Window " << argv[1] + 5 << L" belongs to process " << processId << L".\n";
    }
    else
    {
        processId = wcstoul(argv[1], nullptr, 0);
    }

    if (processId == 0)
    {
        usage();
        return 1;
    }

    bool includeProcessTree;
    if (wcscmp(argv[2], L"includetree") == 0)
    {
        includeProcessTree = true;
    }
    else if (wcscmp(argv[2], L"excludetree") == 0)
    {
        includeProcessTree = false;
    }
    else
    {
        usage();
        return 1;
    }

    PCWSTR outputFile = argv[3];

    CLoopbackCapture loopbackCapture;
    HRESULT hr = loopbackCapture.StartCaptureAsync(processId, includeProcessTree, outputFile);
    if (FAILED(hr))
    {
        wil::unique_hlocal_string message;
        FormatMessageW(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS | FORMAT_MESSAGE_ALLOCATE_BUFFER, nullptr, hr,
            MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT), (PWSTR)&message, 0, nullptr);
        std::wcerr << L"Failed to start capture\n0x" << std::hex << hr << L": " << message.get() << L"\n";
        return 1;
    }
    else
    {
        std::wcerr << L"Capturing audio." << std::endl;
        // Keep the capture alive until the host process terminates us.
        while (true)
        {
            Sleep(1000);
        }

        loopbackCapture.StopCaptureAsync();

        std::wcerr << L"Finished.\n";
    }

    return 0;
}
