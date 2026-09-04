package com.example.notebook_clone.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;
//核心作用：它提供了一种将“任务的提交”与“任务的执行”解耦的机制。
//简单理解：你只需要把任务（通常是一个 Runnable 对象）扔给 Executor，
// 至于这个任务是立即执行、排队等待、还是在新线程里执行，都由 Executor 的具体实现来决定。
//在 Spring 中的作用：Spring 的 @Async 注解底层就是依赖 Executor 来运行异步方法的。
// 当你标注 @Async 时，Spring 会找一个 Executor 把你的方法放到另一个线程里去跑。
import java.util.concurrent.ThreadPoolExecutor;  // 25新增这行
@Configuration
@EnableAsync
public class AsyncConfig {
        /**
     * 创建并配置一个专用于 AI 任务的异步线程池。
     * 
     * ThreadPoolTaskExecutor 是 Spring 对 Java 原生线程池的封装，具有以下作用：
     * 1. 任务解耦：将任务的提交与执行分离，通过 @Async 注解即可让方法在后台线程运行。
     * 2. 资源管理：通过核心线程数、最大线程数和队列容量限制并发度，防止高负载拖垮系统。
     * 3. Spring 集成：作为 Spring Bean 管理，支持优雅关闭（等待任务完成后再销毁线程）。
     * 4. 调试友好：支持设置线程名称前缀，方便在日志中追踪异步任务的执行情况。
     * 
     * @return Executor 实例，供 @Async("aiTaskExecutor") 引用
     */
    @Bean(name = "aiTaskExecutor")
    //将这个线程池注册为 Spring 容器中的一个 Bean，并命名为 aiTaskExecutor。
    // 在需要使用该线程池时，可以通过这个名称进行引用（例如在 @Async("aiTaskExecutor") 注解中）。
    public Executor aiTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(5);//当任务队列满了之后，线程池最多可以创建 5 个线程来并发处理任务
        executor.setQueueCapacity(50);//任务队列容量为 50
        executor.setThreadNamePrefix("ai-async-");//线程名前缀
        executor.setRejectedExecutionHandler(
            new ThreadPoolExecutor.CallerRunsPolicy()//当线程池达到最大线程数（5）且队列也满了（50）时，新提交的任务会被拒绝。
        );
        executor.initialize();//初始化线程池，使其准备好接收任务
        return executor;
    }
}


