using System.Text;
using NAudio.CoreAudioApi;
using NAudio.Wave;

using var enumerator = new MMDeviceEnumerator();
using var device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
using var capture = new WasapiLoopbackCapture(device);
using var output = Console.OpenStandardOutput();

var format = capture.WaveFormat;
var header = $"{{\"sampleRate\":{format.SampleRate},\"channels\":{format.Channels},\"bitsPerSample\":{format.BitsPerSample},\"encoding\":\"{format.Encoding}\"}}\n";
var headerBytes = Encoding.UTF8.GetBytes(header);
output.Write(headerBytes, 0, headerBytes.Length);
output.Flush();

capture.DataAvailable += (_, args) =>
{
    try
    {
        output.Write(args.Buffer, 0, args.BytesRecorded);
        output.Flush();
    }
    catch
    {
        capture.StopRecording();
    }
};

capture.RecordingStopped += (_, _) => Environment.Exit(0);

Console.CancelKeyPress += (_, args) =>
{
    args.Cancel = true;
    capture.StopRecording();
};

capture.StartRecording();
await Task.Delay(Timeout.InfiniteTimeSpan);
