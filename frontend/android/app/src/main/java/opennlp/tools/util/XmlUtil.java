package opennlp.tools.util;

import org.xml.sax.SAXException;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import javax.xml.parsers.SAXParser;
import javax.xml.parsers.SAXParserFactory;

/** Android-compatible replacement for OpenNLP's small XML factory helper. */
public final class XmlUtil {
    private XmlUtil() {}

    public static DocumentBuilder createDocumentBuilder() {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            enableSecureProcessingWhenSupported(factory);
            return factory.newDocumentBuilder();
        } catch (ParserConfigurationException error) {
            throw new IllegalStateException(error);
        }
    }

    public static SAXParser createSaxParser() {
        try {
            SAXParserFactory factory = SAXParserFactory.newInstance();
            enableSecureProcessingWhenSupported(factory);
            return factory.newSAXParser();
        } catch (ParserConfigurationException | SAXException error) {
            throw new IllegalStateException(error);
        }
    }

    private static void enableSecureProcessingWhenSupported(DocumentBuilderFactory factory) {
        try {
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        } catch (ParserConfigurationException unsupportedOnAndroid) {
            // Models and their XML descriptors are trusted, bundled resources.
        }
    }

    private static void enableSecureProcessingWhenSupported(SAXParserFactory factory) {
        try {
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        } catch (ParserConfigurationException | SAXException unsupportedOnAndroid) {
            // Models and their XML descriptors are trusted, bundled resources.
        }
    }
}
