package com.example.notebook_clone.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class LegacyVectorStoreImporterTests {
    private final ObjectMapper mapper = new ObjectMapper();

    private String fixture(String metadataId, String embedding) {
        return """
                {"doc:10:chunk:0":{"id":"doc:10:chunk:0","text":"旧分块正文",
                "metadata":{"documentId":%s,"documentTitle":"文档"},"embedding":%s}}
                """.formatted(metadataId, embedding);
    }

    @Test
    void parsesExistingVectorsWithoutChangingIdsOrNumericMetadata() throws Exception {
        var chunks = LegacyVectorStoreImporter.parse(mapper.readTree(fixture("10", "[0.1,0.2]")), 2);
        assertEquals(1, chunks.size());
        assertEquals("doc:10:chunk:0", chunks.getFirst().id());
        assertEquals(10L, chunks.getFirst().documentId());
        assertTrue(mapper.readTree(chunks.getFirst().metadata()).get("documentId").isNumber());
        assertEquals("[0.1,0.2]", chunks.getFirst().embedding());
    }

    @Test
    void rejectsDimensionMismatch() throws Exception {
        var root = mapper.readTree(fixture("10", "[0.1,0.2]"));
        assertThrows(IllegalArgumentException.class, () -> LegacyVectorStoreImporter.parse(root, 2048));
    }

    @Test
    void rejectsMetadataForAnotherDocument() throws Exception {
        var root = mapper.readTree(fixture("11", "[0.1,0.2]"));
        assertThrows(IllegalArgumentException.class, () -> LegacyVectorStoreImporter.parse(root, 2));
    }

    @Test
    void rejectsNonNumericVectorElements() throws Exception {
        var root = mapper.readTree(fixture("10", "[0.1,null]"));
        assertThrows(IllegalArgumentException.class, () -> LegacyVectorStoreImporter.parse(root, 2));
    }

    @Test
    void rejectsMismatchedMapKey() throws Exception {
        var root = mapper.readTree(fixture("10", "[0.1,0.2]")
                .replaceFirst("doc:10:chunk:0", "doc:11:chunk:0"));
        assertThrows(IllegalArgumentException.class, () -> LegacyVectorStoreImporter.parse(root, 2));
    }
}
