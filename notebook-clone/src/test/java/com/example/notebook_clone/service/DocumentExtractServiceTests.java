package com.example.notebook_clone.service;

import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * 文档提取与清洗的纯单元测试。
 *
 * 测试只调用公开的 extractText()：文件类型判断、内容提取和私有清洗逻辑会作为
 * 一条完整流程被验证。所有上传文件都在内存中构造，不读取用户的真实文件。
 */
class DocumentExtractServiceTests {

    private DocumentExtractService extractService;

    @BeforeEach
    void setUp() {
        extractService = new DocumentExtractService();
    }

    /** TXT 应清除控制字符、每行首尾空白，并把三个以上连续换行规整为两个。 */
    @Test
    void txtRemovesControlCharactersAndNormalizesWhitespace() throws Exception {
        MockMultipartFile file = textFile(
                "notes.txt",
                "  \u0000标题\u0007  \n\n\n\n  正文内容  ");

        String result = extractService.extractText(file);

        assertEquals("标题\n\n正文内容", result);
    }

    /** 文件扩展名转换为小写后再判断，因此大写 .MD 也必须支持。 */
    @Test
    void markdownExtensionIsCaseInsensitive() throws Exception {
        MockMultipartFile file = textFile("README.MD", "# 项目说明");

        String result = extractService.extractText(file);

        assertEquals("# 项目说明", result);
    }

    /** 同一非空行出现三次及以上时，按重复页眉或页脚处理。 */
    @Test
    void repeatedHeaderIsRemoved() throws Exception {
        MockMultipartFile file = textFile(
                "report.txt",
                "公司内部资料\n正文一\n公司内部资料\n正文二\n公司内部资料\n正文三");

        String result = extractService.extractText(file);

        assertEquals("正文一\n正文二\n正文三", result);
    }

    /** 字符间大量插入空格、且长度足够的行会被识别为 PDF 水印噪声。 */
    @Test
    void spacedWatermarkLineIsRemoved() throws Exception {
        MockMultipartFile file = textFile(
                "report.txt",
                "S e c r e t L e v e l\n这是需要保留的正文");

        String result = extractService.extractText(file);

        assertEquals("这是需要保留的正文", result);
    }

    /** 使用 Apache POI 在内存中生成真实 DOCX，验证段落能够按顺序提取。 */
    @Test
    void docxParagraphsAreExtractedInOrder() throws Exception {
        byte[] docxBytes;
        try (XWPFDocument document = new XWPFDocument();
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            document.createParagraph().createRun().setText("第一段");
            document.createParagraph().createRun().setText("第二段");
            document.write(output);
            docxBytes = output.toByteArray();
        }
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "example.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                docxBytes);

        String result = extractService.extractText(file);

        assertEquals("第一段\n第二段", result);
    }

    /** 未列入白名单的文件格式必须明确拒绝，不能按普通文本悄悄处理。 */
    @Test
    void unsupportedFileTypeIsRejected() {
        MockMultipartFile file = textFile("program.exe", "not a document");

        UnsupportedOperationException exception = assertThrows(
                UnsupportedOperationException.class,
                () -> extractService.extractText(file));

        assertEquals("不支持的文件格式: program.exe", exception.getMessage());
    }

    /** 没有原始文件名时无法判断扩展名，应在读取内容前立即失败。 */
    @Test
    void missingOriginalFilenameIsRejected() {
        MockMultipartFile file = new MockMultipartFile(
                "file",
                null,
                "text/plain",
                "正文".getBytes(StandardCharsets.UTF_8));

        IllegalArgumentException exception = assertThrows(
                IllegalArgumentException.class,
                () -> extractService.extractText(file));

        assertEquals("文件名不能为空", exception.getMessage());
    }

    /** 创建 UTF-8 文本上传对象，供 TXT/Markdown/非法扩展名测试复用。 */
    private MockMultipartFile textFile(String filename, String content) {
        return new MockMultipartFile(
                "file",
                filename,
                "text/plain",
                content.getBytes(StandardCharsets.UTF_8));
    }
}
