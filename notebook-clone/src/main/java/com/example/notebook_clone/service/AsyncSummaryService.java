package com.example.notebook_clone.service;

import com.example.notebook_clone.entity.Document;
import com.example.notebook_clone.repository.DocumentRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

@Slf4j//添加日志功能
@Service//声明这个类是一个服务类
@RequiredArgsConstructor//
public class AsyncSummaryService {

    private final AiSummaryService aiSummaryService;
    private final DocumentRepository documentRepository;

    @Async("aiTaskExecutor")
    /**
     * "aiTaskExecutor" 是 Bean 名称。写 @Async("aiTaskExecutor") 
     * 就是告诉 Spring："用我自定义的那个线程池，别用默认的"。
     * 不写名字的话 Spring 会用默认的 SimpleAsyncTaskExecutor（每次都新建线程，很不靠谱）。
     */
    public void generateSummaryAsync(Long documentId) {
        /**
         * void 是因为——调用方（上传接口）不会等这个结果。异步方法跑在另一个线程里，
         * 就算返回了 String，调用方也拿不到。真要返回值得用 CompletableFuture<String>，
         * 但这里不需要：摘要直接存数据库了，用户下次刷新页面就能看到。
         */
        log.info("[异步摘要] 开始生成文档 {} 的摘要", documentId);

        try {
            // 1. 查文档
            Document document = documentRepository.findById(documentId).orElse(null);
            if (document == null) {
                log.warn("[异步摘要] 文档 {} 不存在，跳过", documentId);
                return;
            }
            if (document.getContent() == null || document.getContent().isEmpty()) {
                log.warn("[异步摘要] 文档 {} 内容为空，跳过摘要生成", documentId);
                documentRepository.updateSummary(documentId, "文档内容为空，无需摘要");
                return;
            }

            // 2. 调 AI 生成摘要（复用已有的 AiSummaryService）
            String summary = aiSummaryService.generateSummary(document.getContent());

            // 3. 保存摘要（定向更新，避免与分块任务的 save 互相覆盖字段）
            documentRepository.updateSummary(documentId, summary);

            log.info("[异步摘要] 文档 {} 摘要生成成功", documentId);

        } catch (Exception e) {
            log.error("[异步摘要] 文档 {} 摘要生成失败: {}", documentId, e.getMessage(), e);
            // 失败时更新 summary 字段，避免前端永远显示"摘要生成中..."
            try {
                documentRepository.updateSummary(documentId, "摘要生成失败，请点击重新生成");
            } catch (Exception saveErr) {
                log.error("[异步摘要] 更新失败状态也出错了: {}", saveErr.getMessage());
            }
        }
    }
}
