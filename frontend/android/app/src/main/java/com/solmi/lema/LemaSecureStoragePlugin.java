package com.solmi.lema;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "LemaSecureStorage")
public class LemaSecureStoragePlugin extends Plugin {
    private static final String KEY_ALIAS = "com.solmi.lema.auth-session.v1";
    private static final String KEY_STORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String STORAGE_FILE = "auth-session-v1.json";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private AtomicFile storageFile() {
        File directory = new File(getContext().getNoBackupFilesDir(), "secure-storage");
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("Could not create secure storage directory");
        }
        return new AtomicFile(new File(directory, STORAGE_FILE));
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEY_STORE);
        keyStore.load(null);
        KeyStore.Entry existing = keyStore.getEntry(KEY_ALIAS, null);
        if (existing instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) existing).getSecretKey();
        }

        KeyGenerator generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            KEY_STORE
        );
        generator.init(
            new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        );
        return generator.generateKey();
    }

    private void resetStorage() {
        storageFile().delete();
        try {
            KeyStore keyStore = KeyStore.getInstance(KEY_STORE);
            keyStore.load(null);
            keyStore.deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) {
            // The encrypted file is already gone. A fresh key will be created on next login.
        }
    }

    private byte[] readAll(FileInputStream input) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int read;
        while ((read = input.read(buffer)) != -1) {
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    @PluginMethod
    public void get(PluginCall call) {
        executor.execute(() -> {
            try {
                AtomicFile file = storageFile();
                if (!file.getBaseFile().isFile()) {
                    JSObject result = new JSObject();
                    result.put("value", JSObject.NULL);
                    call.resolve(result);
                    return;
                }

                String payload;
                try (FileInputStream input = file.openRead()) {
                    payload = new String(readAll(input), StandardCharsets.UTF_8);
                }
                JSObject encrypted = new JSObject(payload);
                byte[] iv = Base64.decode(encrypted.getString("iv"), Base64.NO_WRAP);
                byte[] ciphertext = Base64.decode(
                    encrypted.getString("ciphertext"),
                    Base64.NO_WRAP
                );

                Cipher cipher = Cipher.getInstance(TRANSFORMATION);
                cipher.init(
                    Cipher.DECRYPT_MODE,
                    getOrCreateKey(),
                    new GCMParameterSpec(128, iv)
                );
                String value = new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);

                JSObject result = new JSObject();
                result.put("value", value);
                call.resolve(result);
            } catch (Exception error) {
                // Corrupt or invalidated credentials must fail closed and sign the user out.
                try {
                    resetStorage();
                } catch (Exception ignored) {
                    // Returning no session is still the safe outcome.
                }
                JSObject result = new JSObject();
                result.put("value", JSObject.NULL);
                call.resolve(result);
            }
        });
    }

    @PluginMethod
    public void set(PluginCall call) {
        String value = call.getString("value");
        if (value == null || value.isEmpty()) {
            call.reject("A non-empty secure storage value is required");
            return;
        }

        executor.execute(() -> {
            AtomicFile file = null;
            FileOutputStream output = null;
            try {
                file = storageFile();
                Cipher cipher = Cipher.getInstance(TRANSFORMATION);
                cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
                byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));

                JSObject encrypted = new JSObject();
                encrypted.put("version", 1);
                encrypted.put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP));
                encrypted.put(
                    "ciphertext",
                    Base64.encodeToString(ciphertext, Base64.NO_WRAP)
                );

                output = file.startWrite();
                output.write(encrypted.toString().getBytes(StandardCharsets.UTF_8));
                output.flush();
                file.finishWrite(output);
                call.resolve();
            } catch (Exception error) {
                if (file != null && output != null) {
                    file.failWrite(output);
                }
                call.reject(
                    error.getMessage() != null
                        ? error.getMessage()
                        : "Could not store the auth session securely",
                    error
                );
            }
        });
    }

    @PluginMethod
    public void clear(PluginCall call) {
        executor.execute(() -> {
            try {
                resetStorage();
                call.resolve();
            } catch (Exception error) {
                call.reject(
                    error.getMessage() != null
                        ? error.getMessage()
                        : "Could not clear the auth session",
                    error
                );
            }
        });
    }
}
