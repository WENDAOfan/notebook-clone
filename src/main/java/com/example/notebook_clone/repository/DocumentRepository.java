package com.example.notebook_clone.repository;
import java.util.List;
import java.util.Optional;
import com.example.notebook_clone.entity.Document;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;


public interface DocumentRepository extends JpaRepository<Document, Long> {
    
    // 🌟 魔法方法：只要你的方法名是以 findBy 开头，后面跟上字段名
    // Spring 就会自动帮你写出类似 `SELECT * FROM document WHERE notebook_id = ?` 的 SQL！
    // List<Document> findByNotebookId(Long notebookId);
    // 第 11 行，改成：
    List<Document> findByNotebook_Id(Long notebookId);
    List<Document> findByUserId(Long userId);
    Optional<Document> findByIdAndUserId(Long id, Long userId);
    Boolean existsByIdAndUserId(Long id, Long userId);

    // 定向更新：避免 @Async 的摘要/分块任务并发 save 全实体时互相覆盖字段
    @Modifying
    @Transactional
    @Query("UPDATE Document d SET d.summary = :summary WHERE d.id = :id")
    void updateSummary(@Param("id") Long id, @Param("summary") String summary);

    @Modifying
    @Transactional
    @Query("UPDATE Document d SET d.chunkCount = :count WHERE d.id = :id")
    void updateChunkCount(@Param("id") Long id, @Param("count") Integer count);

    @Query("SELECT d.id FROM Document d WHERE d.notebook.id = :notebookId")
    List<Long> findIdsByNotebookId(@Param("notebookId") Long notebookId);
}