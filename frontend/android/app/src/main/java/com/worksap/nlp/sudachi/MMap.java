package com.worksap.nlp.sudachi;

import java.io.FileInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.channels.FileChannel;

/** Android API 24-compatible replacement for Sudachi's MethodHandle cleanup helper. */
public final class MMap {
    private MMap() { }

    public static ByteBuffer map(String path) throws IOException {
        try (FileInputStream input = new FileInputStream(path);
             FileChannel channel = input.getChannel()) {
            return channel.map(FileChannel.MapMode.READ_ONLY, 0, channel.size())
                .order(ByteOrder.LITTLE_ENDIAN);
        }
    }

    public static void unmap(ByteBuffer buffer) {
        // ART releases mapped buffers after they become unreachable.  Explicit
        // Unsafe-based cleanup is unavailable on Android API 24 and is not
        // needed because the language-pack directory is never replaced while
        // this analyzer is live.
    }
}
