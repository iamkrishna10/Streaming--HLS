const express = require('express');
const fileUpload = require('express-fileupload');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadsDir = path.join(__dirname, 'uploads');
const streamsDir = path.join(__dirname, 'streams');
const viewsDir = path.join(__dirname, 'views');
const jsonFilePath = path.join(__dirname, 'streams.json');

if (!fs.existsSync(jsonFilePath)) {
    fs.writeFileSync(jsonFilePath, JSON.stringify([]));
}

app.use(fileUpload());

app.get('/', (req, res) => {
    res.sendFile(path.join(viewsDir, 'upload.html'));
});

app.get('/streamhls/:streamname', (req, res) => {
    res.sendFile(path.join(viewsDir, 'index.html'));
});

app.use('/streams', express.static(streamsDir, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.m3u8')) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        } else if (filePath.endsWith('.ts')) {
            res.setHeader('Content-Type', 'video/MP2T');
        }
    }
}));

app.post('/upload', async (req, res) => {
    try {
        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).send('No files were uploaded.');
        }

        const uploadedFile = req.files.video;
        const filePath = path.join(uploadsDir, uploadedFile.name);
        await uploadedFile.mv(filePath);

        const streamName = path.basename(uploadedFile.name, path.extname(uploadedFile.name));
        const streamDirPath = path.join(streamsDir, streamName);
        const streamPath = path.join(streamDirPath, `${streamName}.m3u8`);

        if (!fs.existsSync(streamDirPath)) {
            fs.mkdirSync(streamDirPath, { recursive: true });
        }

        const ffmpegProcess = spawn('ffmpeg', [
            '-i', filePath,
            '-c:v', 'libx264',
            '-c:a', 'aac',
            '-hls_time', '3',
            '-hls_list_size', '0',
            '-hls_segment_filename', path.join(streamDirPath, `${streamName}_%03d.ts`),
            '-f', 'hls',
            streamPath
        ]);

        ffmpegProcess.stderr.on('data', (data) => {
            console.error(`ffmpeg stderr: ${data}`);
        });

        ffmpegProcess.on('error', (err) => {
            console.error('Error during ffmpeg execution:', err);
            return res.status(500).send('Error generating HLS stream.');
        });

        ffmpegProcess.on('close', () => {
            console.log('HLS stream generation complete.');
            const streamUrl = `http://localhost:${PORT}/streams/${streamName}/${streamName}.m3u8`;
            const streamHlsUrl = `http://localhost:${PORT}/streamhls/${streamName}`;

            const data = fs.readFileSync(jsonFilePath);
            const streamsData = JSON.parse(data);
            streamsData.push({ streamName, streamUrl, streamHlsUrl });
            fs.writeFileSync(jsonFilePath, JSON.stringify(streamsData));

            res.redirect(streamHlsUrl);
        });
    } catch (error) {
        console.error('Error handling file upload:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/allstreams', (req, res) => {
    res.sendFile(path.join(viewsDir, 'allstreams.html'));
});

app.get('/api/streams', (req, res) => {
    const data = fs.readFileSync(jsonFilePath);
    res.json(JSON.parse(data));
});

app.get('/clean', (req, res) => {
    fs.readdir(streamsDir, (err, files) => {
        if (err) {
            console.error('Error reading streams directory:', err);
            return res.status(500).send('Error reading streams directory.');
        }

        files.forEach(file => {
            const filePath = path.join(streamsDir, file);
            fs.unlink(filePath, err => {
                if (err) {
                    console.error(`Error deleting file ${filePath}:`, err);
                }
            });
        });

        fs.writeFileSync(jsonFilePath, JSON.stringify([]));

        res.json({ data: "Cleanup complete!" });
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
