package com.solmi.lema;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Collections;
import java.util.List;
import java.util.zip.GZIPOutputStream;

public class KiwiModelArchiveTest {
    @Rule
    public final TemporaryFolder temporary = new TemporaryFolder();

    @Test
    public void extractsOnlyRequiredBaseModelFiles() throws Exception {
        File output = temporary.newFolder("kiwi");
        KiwiModelArchive.extract(
            new ByteArrayInputStream(modelArchive(KoreanNlpAnalyzer.REQUIRED_MODEL_FILES)),
            output
        );

        assertTrue(KoreanNlpAnalyzer.modelsAvailable(output));
        assertEquals(
            "model:cong.mdl",
            new String(
                Files.readAllBytes(new File(output, "cong.mdl").toPath()),
                StandardCharsets.UTF_8
            )
        );
        assertTrue(!new File(output, "ignored.txt").exists());
    }

    @Test
    public void rejectsArchiveMissingRequiredFiles() throws Exception {
        File output = temporary.newFolder("incomplete");
        try {
            KiwiModelArchive.extract(
                new ByteArrayInputStream(modelArchive(Collections.singletonList("cong.mdl"))),
                output
            );
            fail("Expected incomplete model archive to fail");
        } catch (Exception error) {
            assertTrue(error.getMessage().contains("missing files"));
        }
    }

    private static byte[] modelArchive(List<String> filenames) throws Exception {
        ByteArrayOutputStream compressed = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(compressed)) {
            for (String filename : filenames) {
                writeTarEntry(
                    gzip,
                    "models/cong/base/" + filename,
                    ("model:" + filename).getBytes(StandardCharsets.UTF_8)
                );
            }
            writeTarEntry(
                gzip,
                "models/cong/base/ignored.txt",
                "ignored".getBytes(StandardCharsets.UTF_8)
            );
            gzip.write(new byte[1024]);
        }
        return compressed.toByteArray();
    }

    private static void writeTarEntry(
        GZIPOutputStream output,
        String name,
        byte[] contents
    ) throws Exception {
        byte[] header = new byte[512];
        byte[] nameBytes = name.getBytes(StandardCharsets.UTF_8);
        System.arraycopy(nameBytes, 0, header, 0, nameBytes.length);
        writeOctal(header, 100, 8, 0644);
        writeOctal(header, 108, 8, 0);
        writeOctal(header, 116, 8, 0);
        writeOctal(header, 124, 12, contents.length);
        writeOctal(header, 136, 12, 0);
        for (int index = 148; index < 156; index += 1) header[index] = ' ';
        header[156] = '0';
        byte[] magic = "ustar\0".getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(magic, 0, header, 257, magic.length);
        int checksum = 0;
        for (byte value : header) checksum += value & 0xff;
        writeOctal(header, 148, 8, checksum);
        output.write(header);
        output.write(contents);
        int padding = (512 - (contents.length % 512)) % 512;
        output.write(new byte[padding]);
    }

    private static void writeOctal(byte[] target, int offset, int length, long value) {
        String encoded = Long.toOctalString(value);
        int start = offset + length - encoded.length() - 1;
        for (int index = offset; index < start; index += 1) target[index] = '0';
        byte[] bytes = encoded.getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(bytes, 0, target, start, bytes.length);
        target[offset + length - 1] = 0;
    }
}
