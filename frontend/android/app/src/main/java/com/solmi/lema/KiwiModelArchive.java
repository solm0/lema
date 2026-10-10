package com.solmi.lema;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.zip.GZIPInputStream;

/** Extracts the fixed Kiwi base-model files without adding a general tar dependency. */
final class KiwiModelArchive {
    private static final int TAR_BLOCK_SIZE = 512;
    private static final String ARCHIVE_PREFIX = "models/cong/base/";

    private KiwiModelArchive() {}

    static void extract(File archive, File targetDirectory) throws Exception {
        try (InputStream input = new BufferedInputStream(new FileInputStream(archive))) {
            extract(input, targetDirectory);
        }
    }

    static void extract(InputStream compressedInput, File targetDirectory) throws Exception {
        if (!targetDirectory.isDirectory() && !targetDirectory.mkdirs()) {
            throw new IOException("Could not create Kiwi model directory");
        }

        Set<String> required = new HashSet<>(KoreanNlpAnalyzer.REQUIRED_MODEL_FILES);
        Set<String> extracted = new HashSet<>();
        byte[] header = new byte[TAR_BLOCK_SIZE];

        try (GZIPInputStream gzip = new GZIPInputStream(compressedInput, 64 * 1024)) {
            while (readTarHeader(gzip, header)) {
                String name = tarName(header);
                long size = parseOctal(header, 124, 12);
                int type = header[156] & 0xff;
                String filename = name.startsWith(ARCHIVE_PREFIX)
                    ? name.substring(ARCHIVE_PREFIX.length())
                    : "";
                boolean wanted = (type == 0 || type == '0')
                    && required.contains(filename)
                    && filename.indexOf('/') < 0;

                if (wanted) {
                    if (!extracted.add(filename)) {
                        throw new IOException("Duplicate Kiwi model file: " + filename);
                    }
                    copyExactly(gzip, new File(targetDirectory, filename), size);
                } else {
                    skipExactly(gzip, size);
                }
                skipExactly(gzip, paddingFor(size));
            }
        }

        required.removeAll(extracted);
        if (!required.isEmpty()) {
            throw new IOException("Kiwi model archive is missing files: " + required);
        }
        if (!KoreanNlpAnalyzer.modelsAvailable(targetDirectory)) {
            throw new IOException("Extracted Kiwi model is incomplete");
        }
    }

    private static boolean readTarHeader(InputStream input, byte[] header) throws IOException {
        int offset = 0;
        while (offset < header.length) {
            int read = input.read(header, offset, header.length - offset);
            if (read < 0) {
                if (offset == 0) return false;
                throw new IOException("Truncated tar header");
            }
            offset += read;
        }
        for (byte value : header) {
            if (value != 0) return true;
        }
        return false;
    }

    private static String tarName(byte[] header) {
        String name = readString(header, 0, 100);
        String prefix = readString(header, 345, 155);
        return prefix.isEmpty() ? name : prefix + "/" + name;
    }

    private static String readString(byte[] bytes, int offset, int length) {
        int end = offset;
        int limit = offset + length;
        while (end < limit && bytes[end] != 0) end += 1;
        return new String(bytes, offset, end - offset, StandardCharsets.UTF_8).trim();
    }

    private static long parseOctal(byte[] bytes, int offset, int length) throws IOException {
        long value = 0;
        boolean found = false;
        for (int index = offset; index < offset + length; index += 1) {
            int current = bytes[index] & 0xff;
            if (current == 0 || current == ' ') {
                if (found) break;
                continue;
            }
            if (current < '0' || current > '7') {
                throw new IOException("Invalid tar size");
            }
            found = true;
            value = (value << 3) + (current - '0');
        }
        return value;
    }

    private static long paddingFor(long size) {
        long remainder = size % TAR_BLOCK_SIZE;
        return remainder == 0 ? 0 : TAR_BLOCK_SIZE - remainder;
    }

    private static void copyExactly(InputStream input, File target, long size) throws IOException {
        try (FileOutputStream output = new FileOutputStream(target)) {
            byte[] buffer = new byte[64 * 1024];
            long remaining = size;
            while (remaining > 0) {
                int read = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                if (read < 0) throw new IOException("Truncated Kiwi model archive");
                output.write(buffer, 0, read);
                remaining -= read;
            }
            output.getFD().sync();
        }
    }

    private static void skipExactly(InputStream input, long size) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        long remaining = size;
        while (remaining > 0) {
            long skipped = input.skip(remaining);
            if (skipped > 0) {
                remaining -= skipped;
                continue;
            }
            int read = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
            if (read < 0) throw new IOException("Truncated Kiwi model archive");
            remaining -= read;
        }
    }
}
